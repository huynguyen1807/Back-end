import crypto from 'crypto';
import mongoose from 'mongoose';

import { FoodItem } from '../models/foodItem.model';
import { Household } from '../models/household.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { StorageLocation } from '../models/storageLocation.model';
import { User } from '../models/user.model';
import { assertHouseholdSharedAccess } from './subscriptionService';

type HouseholdRole = 'OWNER' | 'MEMBER';

type MemberPermission = {
  canViewInventory?: boolean;
  canEditInventory?: boolean;
  canViewShoppingList?: boolean;
  canEditShoppingList?: boolean;
  canInviteMember?: boolean;
};

const DEFAULT_MEMBER_PERMISSION: Required<MemberPermission> = {
  canViewInventory: true,
  canEditInventory: true,
  canViewShoppingList: true,
  canEditShoppingList: true,
  canInviteMember: false
};

const OWNER_PERMISSION: Required<MemberPermission> = {
  canViewInventory: true,
  canEditInventory: true,
  canViewShoppingList: true,
  canEditShoppingList: true,
  canInviteMember: true
};

type Session = mongoose.ClientSession;

export class HouseholdMembershipError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'HouseholdMembershipError';
  }
}

// Every membership/capacity mutation writes this same document. Concurrent
// transactions on a household conflict and are retried against fresh state.
async function lockHousehold(householdId: string, session: Session) {
  assertValidObjectId(householdId, 'householdId');
  const household = await Household.findOneAndUpdate(
    { _id: householdId, status: 'ACTIVE' },
    { $inc: { membershipRevision: 1 } },
    { session, returnDocument: 'after' },
  );
  if (!household) throw new HouseholdMembershipError('Household not found', 404);
  return household;
}

function assertValidObjectId(id: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is invalid`);
  }
}

function normalizeEmail(email?: string) {
  return typeof email === 'string' ? email.trim().toLowerCase() : undefined;
}

function buildPermission(role: HouseholdRole, permission?: MemberPermission) {
  const base = role === 'OWNER' ? OWNER_PERMISSION : DEFAULT_MEMBER_PERMISSION;
  const nextPermission = { ...base, ...(permission ?? {}) };

  if (role === 'MEMBER') {
    nextPermission.canInviteMember = false;
  }

  return nextPermission;
}

async function getActiveMember(householdId: string, userId: string, session?: Session) {
  return HouseholdMember.findOne({ householdId, userId, status: 'ACTIVE' }, null, { session });
}

async function ensureHouseholdExists(householdId: string) {
  assertValidObjectId(householdId, 'householdId');

  const household = await Household.findOne({ _id: householdId, status: 'ACTIVE' });
  if (!household) {
    throw new Error('Household not found');
  }

  return household;
}

async function ensureCanManageMembers(householdId: string, userId: string, session?: Session, household?: any) {
  const currentHousehold = household ?? await ensureHouseholdExists(householdId);
  const member = await getActiveMember(householdId, userId, session);
  if (!member || member.role !== 'OWNER' || String(currentHousehold.ownerId) !== userId) {
    throw new HouseholdMembershipError('Only owner can manage household members', 403);
  }
  return member;
}

async function ensureHouseholdOwner(householdId: string, userId: string, session?: Session, household?: any) {
  return ensureCanManageMembers(householdId, userId, session, household);
}

async function ensureHouseholdOwnerHasPremium(householdId: string) {
  const household = await ensureHouseholdExists(householdId);
  await assertHouseholdSharedAccess(householdId, 'EDIT');
  return household;
}

async function ensureHouseholdHasAvailableSlot(householdId: string, session: Session, exceptInvitationId?: string) {
  const entitlement = await assertHouseholdSharedAccess(householdId, 'EDIT', session);
  const maxMembers = entitlement.limits?.maxMembers;
  if (!Number.isInteger(maxMembers) || maxMembers < 1) throw new HouseholdMembershipError('Family plan member limit is not configured', 403);
  const activeMembers = await HouseholdMember.countDocuments({ householdId, status: 'ACTIVE' }).session(session);
  const pendingInvitations = await HouseholdInvitation.countDocuments({
    householdId, status: 'PENDING', expiresAt: { $gt: new Date() },
    ...(exceptInvitationId ? { _id: { $ne: exceptInvitationId } } : {}),
  }).session(session);
  // Acceptance replaces its existing reservation; it must not count it twice.
  if (activeMembers + pendingInvitations >= maxMembers) {
    throw new HouseholdMembershipError('Family Cloud member limit reached', 403);
  }
}

async function assertUserCanCreateOrJoinFamilyPlan(
  userId: string,
  email: string,
  exceptInvitationId?: string,
  session?: Session
) {
  const existingMembership = await HouseholdMember.findOne({ userId, status: 'ACTIVE' }, null, { session });
  if (existingMembership) {
    throw new Error('User already belongs to a family plan');
  }

  const invitationQuery: any = {
    inviteEmail: email,
    status: 'PENDING',
    expiresAt: { $gt: new Date() }
  };

  if (exceptInvitationId) {
    invitationQuery._id = { $ne: exceptInvitationId };
  }

  const existingInvitation = await HouseholdInvitation.findOne(invitationQuery, null, { session });

  if (existingInvitation) {
    throw new Error('User already has a pending family invitation');
  }
}

async function expirePendingInvitations() {
  await HouseholdInvitation.updateMany(
    {
      status: 'PENDING',
      expiresAt: { $lte: new Date() }
    },
    { status: 'EXPIRED' }
  );
}

async function mergeUserInventoryIntoHousehold(userId: string, householdId: string, session: Session) {
  // Keep existing transfer semantics, but use sequential writes in one session.
  await StorageLocation.updateMany({ ownerType: 'USER', userId }, {
    $set: { ownerType: 'HOUSEHOLD', householdId }, $unset: { userId: '' },
  }, { session });
  await FoodItem.updateMany({ ownerType: 'USER', userId }, {
    $set: { ownerType: 'HOUSEHOLD', householdId, updatedBy: userId }, $unset: { userId: '' },
  }, { session });
}

async function transferHouseholdInventoryToOwner(householdId: string, ownerId: string, session: Session) {
  await StorageLocation.updateMany({ ownerType: 'HOUSEHOLD', householdId }, {
    $set: { ownerType: 'USER', userId: ownerId }, $unset: { householdId: '' },
  }, { session });
  await FoodItem.updateMany({ ownerType: 'HOUSEHOLD', householdId }, {
    $set: { ownerType: 'USER', userId: ownerId, updatedBy: ownerId }, $unset: { householdId: '' },
  }, { session });
}

export async function createHousehold(userId: string, data: any) {
  const householdName = data.householdName?.trim();
  if (!householdName) throw new Error('householdName is required');
  await expirePendingInvitations();
  return mongoose.connection.transaction(async (session) => {
    const user = await User.findById(userId, null, { session });
    if (!user) throw new Error('User not found');
    await assertUserCanCreateOrJoinFamilyPlan(userId, user.email, undefined, session);
    const [household] = await Household.create([{
      householdName, ownerId: userId, planType: 'FREE', status: 'ACTIVE',
    }], { session });
    await HouseholdMember.create([{
      householdId: household._id, userId, role: 'OWNER', permission: OWNER_PERMISSION, status: 'ACTIVE',
    }], { session });
    return household;
  });
}

export async function getMyHouseholds(userId: string) {
  const memberships = await HouseholdMember.find({ userId, status: 'ACTIVE' })
    .populate('householdId')
    .sort({ updatedAt: -1 });

  return memberships
    .filter((membership) => membership.householdId)
    .map((membership) => ({
      membershipId: membership._id,
      role: membership.role,
      permission: membership.permission,
      joinedAt: membership.joinedAt,
      household: membership.householdId
    }));
}

export async function deleteHousehold(householdId: string, requesterId: string) {
  return mongoose.connection.transaction(async (session) => {
    const household = await lockHousehold(householdId, session);
    await ensureHouseholdOwner(householdId, requesterId, session, household);
    await transferHouseholdInventoryToOwner(householdId, String(household.ownerId), session);
    await HouseholdMember.updateMany({ householdId, status: 'ACTIVE' }, { status: 'REMOVED' }, { session });
    await HouseholdInvitation.updateMany({ householdId, status: 'PENDING' }, { status: 'CANCELLED' }, { session });
    household.status = 'INACTIVE';
    await household.save({ session });
    return { message: 'Household deleted' };
  });
}

export async function getHouseholdMembers(householdId: string, requesterId: string) {
  await ensureHouseholdExists(householdId);

  const requesterMember = await getActiveMember(householdId, requesterId);
  if (!requesterMember) {
    throw new Error('You are not a member of this household');
  }

  return HouseholdMember.find({ householdId, status: 'ACTIVE' })
    .populate('userId', 'fullName email avatarUrl phoneNumber')
    .sort({ role: 1, joinedAt: 1 });
}

export async function addHouseholdMember(householdId: string, requesterId: string, data: any) {
  await expirePendingInvitations();
  const checkedHousehold = await ensureHouseholdOwnerHasPremium(householdId);
  const userId = data.userId;
  const email = normalizeEmail(data.email);
  if (!userId && !email) throw new Error('userId or email is required');
  if (!userId && (email!.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email!))) {
    throw new HouseholdMembershipError('Email người nhận không hợp lệ.', 400);
  }
  if (userId) assertValidObjectId(userId, 'userId');
  return mongoose.connection.transaction(async (session) => {
    const household = await lockHousehold(householdId, session);
    if (String(household.ownerId) !== String(checkedHousehold.ownerId)) throw new HouseholdMembershipError('Household owner changed', 409);
    await ensureCanManageMembers(householdId, requesterId, session, household);
    await ensureHouseholdHasAvailableSlot(householdId, session);
    const invitedUser = await User.findOne(userId ? { _id: userId, status: 'ACTIVE' } : { email, status: 'ACTIVE' }, null, { session });
    if (!invitedUser) throw new HouseholdMembershipError('Không tìm thấy tài khoản đang hoạt động với email này. Chỉ có thể mời người đã đăng ký FreshFriends.', 404);
    const inviteEmail = normalizeEmail(invitedUser.email);
    if (!inviteEmail) throw new Error('User email is invalid');
    await assertUserCanCreateOrJoinFamilyPlan(String(invitedUser._id), inviteEmail, undefined, session);
    const [invitation] = await HouseholdInvitation.create([{
      householdId, invitedBy: requesterId, inviteEmail,
      inviteToken: crypto.randomBytes(24).toString('hex'), status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }], { session });
    return { member: null, invitation };
  });
}

export async function getHouseholdInvitations(householdId: string, requesterId: string) {
  await expirePendingInvitations();
  await ensureHouseholdExists(householdId);
  await ensureCanManageMembers(householdId, requesterId);

  return HouseholdInvitation.find({
    householdId,
    status: 'PENDING',
    expiresAt: { $gt: new Date() }
  })
    .populate('invitedBy', 'fullName email avatarUrl')
    .sort({ createdAt: -1 });
}

export async function getMyHouseholdInvitations(userId: string) {
  await expirePendingInvitations();

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error('User email is invalid');
  }

  return HouseholdInvitation.find({
    inviteEmail: email,
    status: 'PENDING',
    expiresAt: { $gt: new Date() }
  })
    .populate('householdId', 'householdName ownerId planType status')
    .populate('invitedBy', 'fullName email avatarUrl')
    .sort({ createdAt: -1 });
}

export async function acceptHouseholdInvitation(userId: string, invitationId: string) {
  assertValidObjectId(invitationId, 'invitationId');
  await expirePendingInvitations();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const email = normalizeEmail(user.email);
  if (!email) throw new Error('User email is invalid');
  const preview = await HouseholdInvitation.findOne({ _id: invitationId, inviteEmail: email });
  if (!preview) throw new Error('Household invitation not found');
  if (preview.expiresAt <= new Date()) throw new HouseholdMembershipError('Household invitation expired', 410);
  if (preview.status !== 'PENDING') throw new HouseholdMembershipError('Household invitation is no longer pending', 409);
  const checkedHousehold = await ensureHouseholdOwnerHasPremium(String(preview.householdId));
  return mongoose.connection.transaction(async (session) => {
    const householdId = String(preview.householdId);
    const household = await lockHousehold(householdId, session);
    if (String(household.ownerId) !== String(checkedHousehold.ownerId)) throw new HouseholdMembershipError('Household owner changed', 409);
    const currentUser = await User.findById(userId, null, { session });
    if (!currentUser || normalizeEmail(currentUser.email) !== email) throw new HouseholdMembershipError('You do not have permission to accept this invitation', 403);
    await assertUserCanCreateOrJoinFamilyPlan(userId, email, invitationId, session);
    await ensureHouseholdHasAvailableSlot(householdId, session, invitationId);
    const invitation = await HouseholdInvitation.findOneAndUpdate({
      _id: invitationId, householdId, inviteEmail: email, status: 'PENDING', expiresAt: { $gt: new Date() },
    }, { $set: { status: 'ACCEPTED' } }, { session, returnDocument: 'after' });
    if (!invitation) throw new HouseholdMembershipError('Household invitation is no longer pending or has expired', 409);
    const existingMember = await HouseholdMember.findOne({ householdId, userId }, null, { session });
    if (existingMember?.role === 'OWNER' || String(household.ownerId) === userId) throw new HouseholdMembershipError('Owner cannot join as a member', 403);
    const memberData = { role: 'MEMBER', permission: DEFAULT_MEMBER_PERMISSION, status: 'ACTIVE', joinedAt: new Date() };
    const member = existingMember
      ? await HouseholdMember.findByIdAndUpdate(existingMember._id, memberData, { session, returnDocument: 'after', runValidators: true })
      : (await HouseholdMember.create([{ householdId, userId, ...memberData }], { session }))[0];
    await mergeUserInventoryIntoHousehold(userId, householdId, session);
    return member;
  });
}

export async function rejectHouseholdInvitation(userId: string, invitationId: string) {
  assertValidObjectId(invitationId, 'invitationId');
  await expirePendingInvitations();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const email = normalizeEmail(user.email);
  if (!email) throw new Error('User email is invalid');
  const preview = await HouseholdInvitation.findOne({ _id: invitationId, inviteEmail: email, status: 'PENDING' });
  if (!preview) throw new Error('Household invitation not found');
  return mongoose.connection.transaction(async (session) => {
    await lockHousehold(String(preview.householdId), session);
    const invitation = await HouseholdInvitation.findOneAndUpdate({
      _id: invitationId, inviteEmail: email, status: 'PENDING', expiresAt: { $gt: new Date() },
    }, { $set: { status: 'CANCELLED' } }, { session, returnDocument: 'after' });
    if (!invitation) throw new HouseholdMembershipError('Household invitation is no longer pending or has expired', 409);
    return { message: 'Household invitation rejected' };
  });
}

export async function cancelHouseholdInvitation(householdId: string, requesterId: string, invitationId: string) {
  assertValidObjectId(invitationId, 'invitationId');
  return mongoose.connection.transaction(async (session) => {
    const household = await lockHousehold(householdId, session);
    await ensureCanManageMembers(householdId, requesterId, session, household);
    const invitation = await HouseholdInvitation.findOneAndUpdate({
      _id: invitationId, householdId, status: 'PENDING', expiresAt: { $gt: new Date() },
    }, { $set: { status: 'CANCELLED' } }, { session, returnDocument: 'after' });
    if (!invitation) throw new HouseholdMembershipError('Household invitation is no longer pending or has expired', 409);
    return { message: 'Household invitation cancelled' };
  });
}

export async function updateHouseholdMember(householdId: string, requesterId: string, memberId: string, data: any) {
  assertValidObjectId(memberId, 'memberId');
  return mongoose.connection.transaction(async (session) => {
    const household = await lockHousehold(householdId, session);
    await ensureCanManageMembers(householdId, requesterId, session, household);
    await assertHouseholdSharedAccess(householdId, 'EDIT', session);
    const targetMember = await HouseholdMember.findOne({ _id: memberId, householdId, status: 'ACTIVE' }, null, { session });
    if (!targetMember) throw new Error('Household member not found');
    const isOwner = String(targetMember.userId) === String(household.ownerId);
    if ((targetMember.role === 'OWNER') !== isOwner) throw new HouseholdMembershipError('Household owner membership is inconsistent', 409);
    if (data.role === 'OWNER') throw new HouseholdMembershipError('Owner role cannot be assigned from this endpoint', 403);
    if (isOwner && data.role !== undefined && data.role !== 'OWNER') throw new HouseholdMembershipError('Owner cannot be demoted', 403);
    const nextRole = data.role ?? targetMember.role;
    if (!['OWNER', 'MEMBER'].includes(nextRole)) throw new Error('role must be MEMBER');
    targetMember.role = nextRole;
    targetMember.permission = isOwner ? OWNER_PERMISSION : buildPermission(nextRole, {
      ...(targetMember.permission?.toObject?.() ?? targetMember.permission ?? {}), ...(data.permission ?? {}),
    });
    await targetMember.save({ session });
    return targetMember;
  });
}

export async function removeHouseholdMember(householdId: string, requesterId: string, memberId: string) {
  assertValidObjectId(memberId, 'memberId');
  return mongoose.connection.transaction(async (session) => {
    const household = await lockHousehold(householdId, session);
    await ensureCanManageMembers(householdId, requesterId, session, household);
    const targetMember = await HouseholdMember.findOne({ _id: memberId, householdId, status: 'ACTIVE' }, null, { session });
    if (!targetMember) throw new Error('Household member not found');
    if (targetMember.role === 'OWNER' || String(targetMember.userId) === String(household.ownerId)) throw new HouseholdMembershipError('Owner cannot be removed from household', 403);
    targetMember.status = 'REMOVED';
    await targetMember.save({ session });
    return { message: 'Household member removed' };
  });
}
