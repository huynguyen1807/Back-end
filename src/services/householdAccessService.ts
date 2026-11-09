import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';
import { assertHouseholdSharedAccess, FamilySubscriptionError } from './subscriptionService';

export class HouseholdAccessError extends Error {
  readonly statusCode = 403;

  constructor(message = 'You do not have permission to access this household inventory') {
    super(message);
    this.name = 'HouseholdAccessError';
  }
}

export async function assertHouseholdInventoryAccess(
  context: { ownerType: string; householdId?: unknown },
  userId: string,
  operation: 'VIEW' | 'EDIT',
): Promise<void> {
  if (context.ownerType !== 'HOUSEHOLD') return;
  if (!context.householdId) throw new HouseholdAccessError();

  const [household, member] = await Promise.all([
    Household.findOne({ _id: context.householdId, status: 'ACTIVE' }),
    HouseholdMember.findOne({ householdId: context.householdId, userId, status: 'ACTIVE' }),
  ]);
  if (!household || household.status !== 'ACTIVE' || !member || member.status !== 'ACTIVE') {
    throw new HouseholdAccessError();
  }

  const isOwner = String(household.ownerId) === userId;
  if (member.role === 'OWNER' && isOwner) {
    await assertSubscriptionAccess(String(context.householdId), operation);
    return;
  }
  // Inconsistent owner records must not grant owner privileges or member access.
  if (member.role !== 'MEMBER' || isOwner) throw new HouseholdAccessError();

  const permission = operation === 'VIEW' ? 'canViewInventory' : 'canEditInventory';
  if (member.permission?.[permission] !== true) throw new HouseholdAccessError();
  await assertSubscriptionAccess(String(context.householdId), operation);
}

async function assertSubscriptionAccess(householdId: string, operation: 'VIEW' | 'EDIT') {
  try { await assertHouseholdSharedAccess(householdId, operation); }
  catch (error) {
    if (error instanceof FamilySubscriptionError) throw new HouseholdAccessError(error.message);
    throw error;
  }
}
