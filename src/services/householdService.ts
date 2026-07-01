import crypto from 'crypto';
import mongoose from 'mongoose';

import { Household } from '../models/household.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { User } from '../models/user.model';

type HouseholdRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type MemberPermission = {
  canViewInventory?: boolean;
  canEditInventory?: boolean;
  canViewShoppingList?: boolean;
  canEditShoppingList?: boolean;
  canInviteMember?: boolean;
};

const DEFAULT_MEMBER_PERMISSION: Required<MemberPermission> = {
  canViewInventory: true,
  canEditInventory: false,
  canViewShoppingList: true,
  canEditShoppingList: false,
  canInviteMember: false
};

const ADMIN_PERMISSION: Required<MemberPermission> = {
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
  const base = role === 'ADMIN' ? ADMIN_PERMISSION : DEFAULT_MEMBER_PERMISSION;
  return { ...base, ...(permission ?? {}) };
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

  const canManage =
    member.role === 'OWNER' || member.role === 'ADMIN' || member.permission?.canInviteMember;

  if (!canManage) {
    throw new Error('You do not have permission to manage household members');
  }

  return member;
}

export async function createHousehold(userId: string, data: any) {
  const householdName = data.householdName?.trim();
  if (!householdName) {
    throw new Error('householdName is required');
  }

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
    permission: ADMIN_PERMISSION,
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

  const role = (data.role ?? 'MEMBER') as HouseholdRole;
  if (!['ADMIN', 'MEMBER'].includes(role)) {
    throw new Error('role must be ADMIN or MEMBER');
  }

  const userId = data.userId;
  const email = normalizeEmail(data.email);

  if (!userId && !email) {
    throw new Error('userId or email is required');
  }

  const invitedUser = userId
    ? await User.findById(userId)
    : await User.findOne({ email, status: 'ACTIVE' });

  if (!invitedUser) {
    if (!email) {
      throw new Error('User not found');
    }

    const invitation = await HouseholdInvitation.create({
      householdId,
      invitedBy: requesterId,
      inviteEmail: email,
      inviteToken: crypto.randomBytes(24).toString('hex'),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    return { invitation, member: null };
  }

  const existingMember = await HouseholdMember.findOne({
    householdId,
    userId: invitedUser._id
  });

  if (existingMember && existingMember.status === 'ACTIVE') {
    throw new Error('User is already a household member');
  }

  const memberPayload = {
    householdId,
    userId: invitedUser._id,
    role,
    permission: buildPermission(role, data.permission),
    status: 'ACTIVE'
  };

  const member = existingMember
    ? await HouseholdMember.findByIdAndUpdate(existingMember._id, memberPayload, { new: true })
    : await HouseholdMember.create(memberPayload);

  return { member, invitation: null };
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
  if (!['OWNER', 'ADMIN', 'MEMBER'].includes(nextRole)) {
    throw new Error('role must be ADMIN or MEMBER');
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

  if (requesterMember.role === 'ADMIN' && targetMember.role === 'ADMIN') {
    throw new Error('Admin cannot remove another admin');
  }

  targetMember.status = 'REMOVED';
  await targetMember.save();

  return { message: 'Household member removed' };
}
