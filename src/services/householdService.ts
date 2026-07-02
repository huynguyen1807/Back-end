import crypto from 'crypto';
import mongoose from 'mongoose';

import { Household } from '../models/household.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { User } from '../models/user.model';

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

function assertValidObjectId(id: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is invalid`);
  }
}

function normalizeEmail(email?: string) {
  return email?.trim().toLowerCase();
}

function buildPermission(role: HouseholdRole, permission?: MemberPermission) {
  const base = role === 'OWNER' ? OWNER_PERMISSION : DEFAULT_MEMBER_PERMISSION;
  const nextPermission = { ...base, ...(permission ?? {}) };

  if (role === 'MEMBER') {
    nextPermission.canInviteMember = false;
  }

  return nextPermission;
}

async function getActiveMember(householdId: string, userId: string) {
  return HouseholdMember.findOne({ householdId, userId, status: 'ACTIVE' });
}

async function ensureHouseholdExists(householdId: string) {
  assertValidObjectId(householdId, 'householdId');

  const household = await Household.findOne({ _id: householdId, status: 'ACTIVE' });
  if (!household) {
    throw new Error('Household not found');
  }

  return household;
}

async function ensureCanManageMembers(householdId: string, userId: string) {
  const member = await getActiveMember(householdId, userId);
  if (!member) {
    throw new Error('You are not a member of this household');
  }

  const canManage = member.role === 'OWNER';

  if (!canManage) {
    throw new Error('You do not have permission to manage household members');
  }

  return member;
}

async function assertUserCanCreateOrJoinFamilyPlan(
  userId: string,
  email: string,
  exceptInvitationId?: string
) {
  await expirePendingInvitations();

  const existingMembership = await HouseholdMember.findOne({ userId, status: 'ACTIVE' });
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

  const existingInvitation = await HouseholdInvitation.findOne(invitationQuery);

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

export async function createHousehold(userId: string, data: any) {
  const householdName = data.householdName?.trim();
  if (!householdName) {
    throw new Error('householdName is required');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  await assertUserCanCreateOrJoinFamilyPlan(userId, user.email);

  const household = await Household.create({
    householdName,
    ownerId: userId,
    planType: data.planType ?? 'FREE',
    status: 'ACTIVE'
  });

  await HouseholdMember.create({
    householdId: household._id,
    userId,
    role: 'OWNER',
    permission: OWNER_PERMISSION,
    status: 'ACTIVE'
  });

  return household;
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
  await ensureHouseholdExists(householdId);
  await ensureCanManageMembers(householdId, requesterId);

  const userId = data.userId;
  const email = normalizeEmail(data.email);

  if (!userId && !email) {
    throw new Error('userId or email is required');
  }

  if (userId) {
    assertValidObjectId(userId, 'userId');
  }

  const invitedUser = userId
    ? await User.findOne({ _id: userId, status: 'ACTIVE' })
    : await User.findOne({ email, status: 'ACTIVE' });

  if (!invitedUser) {
    throw new Error('User not found');
  }

  const inviteEmail = normalizeEmail(invitedUser.email);
  if (!inviteEmail) {
    throw new Error('User email is invalid');
  }

  await assertUserCanCreateOrJoinFamilyPlan(invitedUser._id.toString(), inviteEmail);

  const invitation = await HouseholdInvitation.create({
    householdId,
    invitedBy: requesterId,
    inviteEmail,
    inviteToken: crypto.randomBytes(24).toString('hex'),
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  return { member: null, invitation };
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
  await expirePendingInvitations();

  assertValidObjectId(invitationId, 'invitationId');

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error('User email is invalid');
  }

  const invitation = await HouseholdInvitation.findOne({
    _id: invitationId,
    inviteEmail: email,
    status: 'PENDING'
  });

  if (!invitation) {
    throw new Error('Household invitation not found');
  }

  if (invitation.expiresAt <= new Date()) {
    invitation.status = 'EXPIRED';
    await invitation.save();
    throw new Error('Household invitation expired');
  }

  await ensureHouseholdExists(invitation.householdId.toString());
  await assertUserCanCreateOrJoinFamilyPlan(userId, email, invitationId);

  const member = await HouseholdMember.create({
    householdId: invitation.householdId,
    userId,
    role: 'MEMBER',
    permission: DEFAULT_MEMBER_PERMISSION,
    status: 'ACTIVE'
  });

  invitation.status = 'ACCEPTED';
  await invitation.save();

  return member;
}

export async function rejectHouseholdInvitation(userId: string, invitationId: string) {
  await expirePendingInvitations();

  assertValidObjectId(invitationId, 'invitationId');

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error('User email is invalid');
  }

  const invitation = await HouseholdInvitation.findOne({
    _id: invitationId,
    inviteEmail: email,
    status: 'PENDING'
  });

  if (!invitation) {
    throw new Error('Household invitation not found');
  }

  invitation.status = 'CANCELLED';
  await invitation.save();

  return { message: 'Household invitation rejected' };
}

export async function cancelHouseholdInvitation(
  householdId: string,
  requesterId: string,
  invitationId: string
) {
  await ensureHouseholdExists(householdId);
  await ensureCanManageMembers(householdId, requesterId);

  assertValidObjectId(invitationId, 'invitationId');

  const invitation = await HouseholdInvitation.findOne({
    _id: invitationId,
    householdId,
    status: 'PENDING'
  });

  if (!invitation) {
    throw new Error('Household invitation not found');
  }

  invitation.status = 'CANCELLED';
  await invitation.save();

  return { message: 'Household invitation cancelled' };
}

export async function updateHouseholdMember(
  householdId: string,
  requesterId: string,
  memberId: string,
  data: any
) {
  await ensureHouseholdExists(householdId);
  const requesterMember = await ensureCanManageMembers(householdId, requesterId);

  assertValidObjectId(memberId, 'memberId');
  const targetMember = await HouseholdMember.findOne({
    _id: memberId,
    householdId,
    status: 'ACTIVE'
  });

  if (!targetMember) {
    throw new Error('Household member not found');
  }

  if (targetMember.role === 'OWNER' && requesterMember.role !== 'OWNER') {
    throw new Error('Only owner can update owner member');
  }

  if (data.role === 'OWNER') {
    throw new Error('Owner role cannot be assigned from this endpoint');
  }

  const nextRole = (data.role ?? targetMember.role) as HouseholdRole;
  if (!['OWNER', 'MEMBER'].includes(nextRole)) {
    throw new Error('role must be MEMBER');
  }

  targetMember.role = nextRole;
  targetMember.permission = buildPermission(nextRole, {
    ...(targetMember.permission?.toObject?.() ?? targetMember.permission ?? {}),
    ...(data.permission ?? {})
  });

  await targetMember.save();
  return targetMember;
}

export async function removeHouseholdMember(
  householdId: string,
  requesterId: string,
  memberId: string
) {
  await ensureHouseholdExists(householdId);
  const requesterMember = await ensureCanManageMembers(householdId, requesterId);

  assertValidObjectId(memberId, 'memberId');
  const targetMember = await HouseholdMember.findOne({
    _id: memberId,
    householdId,
    status: 'ACTIVE'
  });

  if (!targetMember) {
    throw new Error('Household member not found');
  }

  if (targetMember.role === 'OWNER') {
    throw new Error('Owner cannot be removed from household');
  }

  targetMember.status = 'REMOVED';
  await targetMember.save();

  return { message: 'Household member removed' };
}
