import crypto from 'crypto';
import mongoose from 'mongoose';

import { FoodItem } from '../models/foodItem.model';
import { Household } from '../models/household.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { StorageLocation } from '../models/storageLocation.model';
import { User } from '../models/user.model';
import { userHasActivePremium } from './subscriptionService';

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

const FAMILY_MEMBER_LIMIT = 6;

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

async function ensureHouseholdOwner(householdId: string, userId: string) {
  const member = await getActiveMember(householdId, userId);
  if (!member || member.role !== 'OWNER') {
    throw new Error('Only owner can delete household');
  }

  return member;
}

async function ensureFamilyCloudPremium(userId: string) {
  const hasPremium = await userHasActivePremium(userId);
  if (!hasPremium) {
    throw new Error('Family Cloud requires an active Premium subscription');
  }
}

async function ensureHouseholdOwnerHasPremium(householdId: string) {
  const household = await ensureHouseholdExists(householdId);
  await ensureFamilyCloudPremium(household.ownerId.toString());
  return household;
}

async function ensureHouseholdHasAvailableSlot(householdId: string) {
  await expirePendingInvitations();

  const [activeMembers, pendingInvitations] = await Promise.all([
    HouseholdMember.countDocuments({ householdId, status: 'ACTIVE' }),
    HouseholdInvitation.countDocuments({
      householdId,
      status: 'PENDING',
      expiresAt: { $gt: new Date() }
    })
  ]);

  if (activeMembers + pendingInvitations >= FAMILY_MEMBER_LIMIT) {
    throw new Error('Family Cloud member limit reached');
  }
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

async function mergeUserInventoryIntoHousehold(userId: string, householdId: string) {
  await Promise.all([
    StorageLocation.updateMany(
      { ownerType: 'USER', userId },
      {
        $set: {
          ownerType: 'HOUSEHOLD',
          householdId
        },
        $unset: { userId: '' }
      }
    ),
    FoodItem.updateMany(
      { ownerType: 'USER', userId },
      {
        $set: {
          ownerType: 'HOUSEHOLD',
          householdId,
          updatedBy: userId
        },
        $unset: { userId: '' }
      }
    )
  ]);
}

async function transferHouseholdInventoryToOwner(householdId: string, ownerId: string) {
  await Promise.all([
    StorageLocation.updateMany(
      { ownerType: 'HOUSEHOLD', householdId },
      {
        $set: {
          ownerType: 'USER',
          userId: ownerId
        },
        $unset: { householdId: '' }
      }
    ),
    FoodItem.updateMany(
      { ownerType: 'HOUSEHOLD', householdId },
      {
        $set: {
          ownerType: 'USER',
          userId: ownerId,
          updatedBy: ownerId
        },
        $unset: { householdId: '' }
      }
    )
  ]);
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

  await ensureFamilyCloudPremium(userId);
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

export async function deleteHousehold(householdId: string, requesterId: string) {
  const household = await ensureHouseholdExists(householdId);
  await ensureHouseholdOwner(householdId, requesterId);

  await transferHouseholdInventoryToOwner(householdId, household.ownerId.toString());

  household.status = 'INACTIVE';
  await household.save();

  await Promise.all([
    HouseholdMember.updateMany({ householdId, status: 'ACTIVE' }, { status: 'REMOVED' }),
    HouseholdInvitation.updateMany(
      { householdId, status: 'PENDING' },
      { status: 'CANCELLED' }
    )
  ]);

  return { message: 'Household deleted' };
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
  await ensureHouseholdOwnerHasPremium(householdId);
  await ensureCanManageMembers(householdId, requesterId);
  await ensureHouseholdHasAvailableSlot(householdId);

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

  await ensureHouseholdOwnerHasPremium(invitation.householdId.toString());
  await assertUserCanCreateOrJoinFamilyPlan(userId, email, invitationId);

  const existingMember = await HouseholdMember.findOne({
    householdId: invitation.householdId,
    userId
  });

  if (existingMember?.status === 'ACTIVE') {
    throw new Error('User is already a household member');
  }

  const member = existingMember
    ? await HouseholdMember.findByIdAndUpdate(
        existingMember._id,
        {
          role: 'MEMBER',
          permission: DEFAULT_MEMBER_PERMISSION,
          status: 'ACTIVE',
          joinedAt: new Date()
        },
        { returnDocument: 'after' }
      )
    : await HouseholdMember.create({
        householdId: invitation.householdId,
        userId,
        role: 'MEMBER',
        permission: DEFAULT_MEMBER_PERMISSION,
        status: 'ACTIVE'
      });

  await mergeUserInventoryIntoHousehold(userId, invitation.householdId.toString());

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
