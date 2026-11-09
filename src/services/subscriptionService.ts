import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { Subscription } from '../models/subscription.model';
import mongoose from 'mongoose';
import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';

export const FAMILY_TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const FAMILY_CATALOG = [
  { planName: 'Family Monthly', planCode: 'FAMILY_MONTHLY', price: 49000, billingPeriodMonths: 1 },
  { planName: 'Family Yearly', planCode: 'FAMILY_YEARLY', price: 499000, billingPeriodMonths: 12 },
] as const;

/** Pure catalog preview. Applying records requires a separately authorized DB. */
export function previewFamilyPlanCatalog(existing: any[] = []) {
  const rows = existing.filter(row => FAMILY_CATALOG.some(plan => plan.planCode === row.planCode));
  if (rows.some(row => row.scope !== 'HOUSEHOLD')) throw new Error('Family plan scope conflicts with existing configuration');
  const defaults = { maxMembers: 6, maxFoodItems: 1000, maxStorageLocations: 10,
    familyCloudEnabled: true, multiStorageEnabled: true, macroReportEnabled: false };
  const limits: Record<string, number | boolean> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const configured = rows.map(row => row.limits?.[key]).filter(value => value !== undefined);
    if (configured.some(value => value !== configured[0])) throw new Error(`Family plans have conflicting configured limits: ${key}`);
    limits[key] = configured[0] ?? fallback;
    if (typeof fallback === 'number' ? !Number.isSafeInteger(limits[key]) || Number(limits[key]) < (key === 'maxMembers' ? 1 : 0)
      : typeof limits[key] !== 'boolean') throw new Error(`Invalid Family plan configuration: ${key}`);
  }
  if (limits.familyCloudEnabled !== true) throw new Error('Existing configuration disables Family capabilities');
  return FAMILY_CATALOG.map(plan => {
    const row = rows.find(row => row.planCode === plan.planCode);
    return { ...plan, scope: 'HOUSEHOLD' as const, currency: 'VND' as const, limits: { ...limits },
      features: row?.features ? [...row.features] : ['Kho gia đình dùng chung', 'Danh sách mua sắm gia đình'],
      isActive: row?.isActive ?? true };
  });
}

const DEFAULT_PLANS = [
  {
    planName: 'Free Plan',
    planCode: 'FREE',
    price: 0,
    currency: 'VND',
    durationDays: 0,
    limits: {
      maxStorageLocations: 1,
      maxFoodItems: 50,
      familyCloudEnabled: false,
      macroReportEnabled: false,
      multiStorageEnabled: false
    },
    features: ['Quản lý thực phẩm cơ bản']
  },
  {
    planName: 'Premium Monthly',
    planCode: 'PREMIUM_MONTHLY',
    price: 49000,
    currency: 'VND',
    durationDays: 30,
    limits: {
      maxStorageLocations: 10,
      maxFoodItems: 1000,
      familyCloudEnabled: true,
      macroReportEnabled: true,
      multiStorageEnabled: true
    },
    features: ['Family Cloud', 'Chia sẻ inventory, meal và shopping list', 'Báo cáo dinh dưỡng']
  },
  {
    planName: 'Premium Yearly',
    planCode: 'PREMIUM_YEARLY',
    price: 499000,
    currency: 'VND',
    durationDays: 365,
    limits: {
      maxStorageLocations: 10,
      maxFoodItems: 1000,
      familyCloudEnabled: true,
      macroReportEnabled: true,
      multiStorageEnabled: true
    },
    features: ['Family Cloud', 'Chia sẻ inventory, meal và shopping list', 'Tiết kiệm hơn gói tháng']
  }
] as const;

export const ensureDefaultSubscriptionPlans = async () => {
  await Promise.all(
    DEFAULT_PLANS.map((plan) =>
      SubscriptionPlan.findOneAndUpdate(
        { planCode: plan.planCode },
        { $setOnInsert: { ...plan, scope: 'USER', limits: { ...plan.limits, maxMembers: 6 }, isActive: true } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      )
    )
  );
};

export function individualSubscriptionFilter() {
  return { $and: [
    { $or: [{ scope: 'USER' }, { scope: { $exists: false } }] },
    { $or: [{ householdId: { $exists: false } }, { householdId: null }] },
  ] };
}

export function revenueCatIndividualFilter() {
  const filter = individualSubscriptionFilter();
  return { $and: [...filter.$and, { $or: [{ provider: 'REVENUECAT' }, { provider: { $exists: false } }] }] };
}

export const getAllSubscriptionPlans = async (scope: 'USER' | 'HOUSEHOLD' = 'USER') => {
  await ensureDefaultSubscriptionPlans();
  return SubscriptionPlan.find({ isActive: true, ...(scope === 'HOUSEHOLD'
    ? { scope: 'HOUSEHOLD' }
    : { $or: [{ scope: 'USER' }, { scope: { $exists: false } }] }) });
};

export const getUserCurrentSubscription = async (userId: string) => {
  await ensureDefaultSubscriptionPlans();

  // Find the active subscription that hasn't expired
  const currentSubscription = await Subscription.findOne({
    userId,
    ...individualSubscriptionFilter(),
    status: 'ACTIVE',
    startDate: { $lte: new Date() },
    endDate: { $gt: new Date() }
  }).populate('planId').sort({ endDate: -1, createdAt: -1 });

  if (!currentSubscription) {
    // If no active premium, return the free plan as default
    const freePlan = await SubscriptionPlan.findOne({ planCode: 'FREE' });
    return {
      appUserId: userId,
      planCode: 'FREE',
      planId: freePlan,
      status: 'ACTIVE',
      isPremium: false,
      limits: freePlan?.limits
    };
  }

  return {
    ...currentSubscription.toObject(),
    appUserId: userId,
    isPremium: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(currentSubscription.planCode),
    // @ts-ignore
    limits: currentSubscription.planId?.limits
  };
};

export const userHasActivePremium = async (userId: string) => {
  const currentSubscription = await getUserCurrentSubscription(userId);
  return Boolean(currentSubscription.isPremium && currentSubscription.limits?.familyCloudEnabled);
};

export class FamilySubscriptionError extends Error {
  readonly statusCode = 403;
  constructor(message = 'Family Cloud requires an active household subscription') {
    super(message);
    this.name = 'FamilySubscriptionError';
  }
}

export class FamilyTrialError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); this.name = 'FamilyTrialError'; }
}

type TrialEligibility = { eligible: boolean; reason: string };

async function trialEligibility(userId: string, householdId: string, activeAccess: boolean, session?: mongoose.ClientSession): Promise<TrialEligibility> {
  // Check lifetime history, including inactive/deleted households and expired
  // grants. Being a member of someone else's trial does not consume a claim.
  const history = await Subscription.findOne({ scope: 'HOUSEHOLD', $and: [
    { $or: [{ userId }, { householdId }] },
    { $or: [{ grantType: 'TRIAL' }, { activatedAt: { $exists: true, $ne: null } }] },
  ] }, null, { session });
  if (history) return { eligible: false, reason: 'FAMILY_HISTORY_EXISTS' };
  if (activeAccess) return { eligible: false, reason: 'FAMILY_ACCESS_ACTIVE' };
  const plan = await SubscriptionPlan.findOne({ scope: 'HOUSEHOLD', planCode: 'FAMILY_MONTHLY', isActive: true }, null, { session });
  if (!configuredLimits(plan, false) || plan?.limits.familyCloudEnabled !== true) return { eligible: false, reason: 'FAMILY_PLAN_UNAVAILABLE' };
  return { eligible: true, reason: 'ELIGIBLE' };
}

async function assertTrialIndexes() {
  // A check-then-insert alone cannot serialize one account across households.
  // Fail closed until both unique partial indexes are deployed by an operator.
  let indexes;
  try { indexes = await Subscription.collection.indexes(); }
  catch { throw new FamilyTrialError('Family trial eligibility safeguards are not configured', 503); }
  for (const [name, field] of [
    ['unique_family_trial_owner_lifetime', 'userId'], ['unique_family_trial_household_lifetime', 'householdId'],
  ]) {
    if (!indexes.some(index => index.name === name && index.unique === true && index.key[field] === 1
      && Object.keys(index.key).length === 1 && index.partialFilterExpression?.scope === 'HOUSEHOLD'
      && index.partialFilterExpression?.grantType === 'TRIAL' && Object.keys(index.partialFilterExpression).length === 2)) {
      throw new FamilyTrialError('Family trial eligibility safeguards are not configured', 503);
    }
  }
}

export async function startHouseholdTrial(userId: string, householdId: string) {
  if (!mongoose.Types.ObjectId.isValid(householdId)) throw new FamilyTrialError('Invalid householdId', 400);
  // Check authorization before revealing index readiness to a caller.
  const membership = await HouseholdMember.findOne({ householdId, userId, role: 'OWNER', status: 'ACTIVE' });
  const preview = await Household.findOne({ _id: householdId, ownerId: userId, status: 'ACTIVE' });
  if (!membership || !preview) throw new FamilyTrialError('Only the active Household Owner can start a trial', 403);
  await assertTrialIndexes();
  try {
    return await mongoose.connection.transaction(async session => {
      const household = await Household.findOneAndUpdate({ _id: householdId, ownerId: userId, status: 'ACTIVE' },
        { $inc: { membershipRevision: 1 } }, { session, returnDocument: 'after' });
      const owner = await HouseholdMember.findOne({ householdId, userId, role: 'OWNER', status: 'ACTIVE' }, null, { session });
      if (!household || !owner) throw new FamilyTrialError('Only the active Household Owner can start a trial', 403);
      const entitlement = await getHouseholdEntitlement(householdId, session);
      const eligibility = await trialEligibility(userId, householdId, entitlement.hasPaidAccess, session);
      if (!eligibility.eligible) throw new FamilyTrialError(eligibility.reason, eligibility.reason === 'FAMILY_PLAN_UNAVAILABLE' ? 503 : 409);
      const plan = await SubscriptionPlan.findOne({ scope: 'HOUSEHOLD', planCode: 'FAMILY_MONTHLY', isActive: true }, null, { session });
      if (!configuredLimits(plan, false) || plan?.limits.familyCloudEnabled !== true) throw new FamilyTrialError('FAMILY_PLAN_UNAVAILABLE', 503);
      const now = new Date();
      const [trial] = await Subscription.create([{
        userId, householdId, scope: 'HOUSEHOLD', grantType: 'TRIAL', planId: plan._id, planCode: 'FAMILY_MONTHLY',
        status: 'ACTIVE', activatedAt: now, startDate: now, endDate: new Date(now.getTime() + FAMILY_TRIAL_DURATION_MS), autoRenew: false,
      }], { session });
      return subscriptionView(trial);
    });
  } catch (error: any) {
    if (error?.code === 11000) throw new FamilyTrialError('FAMILY_HISTORY_EXISTS', 409);
    throw error;
  }
}

function subscriptionView(subscription: any) {
  if (!subscription) return null;
  return {
    id: String(subscription._id), planCode: subscription.planCode,
    status: subscription.status === 'ACTIVE' && new Date(subscription.endDate) <= new Date() ? 'EXPIRED' : subscription.status,
    startDate: subscription.startDate, endDate: subscription.endDate,
    autoRenew: Boolean(subscription.autoRenew),
    ...(subscription.scope === 'HOUSEHOLD' ? { grantType: subscription.grantType ?? 'PAID' } : {}),
  };
}

function configuredLimits(plan: any, legacy: boolean) {
  if (!plan?.limits) return null;
  const limits = plan.limits.toObject?.() ?? { ...plan.limits };
  if (legacy && limits.maxMembers === undefined) limits.maxMembers = 6;
  if (!Number.isInteger(limits.maxMembers) || limits.maxMembers < 1
    || !Number.isInteger(limits.maxFoodItems) || limits.maxFoodItems < 0
    || !Number.isInteger(limits.maxStorageLocations) || limits.maxStorageLocations < 0) return null;
  return limits;
}

// This resolver is read-only and can participate in a caller's transaction.
// A verified household activation permanently takes precedence over legacy
// owner Premium, including after that household subscription expires.
export async function getHouseholdEntitlement(householdId: string, session?: mongoose.ClientSession) {
  const now = new Date();
  const household = await Household.findOne({ _id: householdId, status: 'ACTIVE' }, null, { session });
  if (!household) throw new FamilySubscriptionError('You do not have permission to access this household');
  const householdFilter = { scope: 'HOUSEHOLD', householdId, activatedAt: { $lte: now } };
  const history = await Subscription.findOne(householdFilter, null, { session })
    .populate('planId').sort({ activatedAt: -1, createdAt: -1 });
  // Informational only: a verified purchase may start after the current trial.
  // Keep future paid periods separate from the current access decision.
  const scheduledSubscription = await Subscription.findOne({ ...householdFilter,
    userId: household.ownerId, grantType: { $ne: 'TRIAL' }, status: 'ACTIVE',
    startDate: { $gt: now }, endDate: { $gt: now },
  }, null, { session }).sort({ startDate: 1 });
  let subscription: any = null;
  let source: 'HOUSEHOLD' | 'LEGACY_OWNER' | 'NONE' = 'NONE';
  let legacy = false;
  if (history) {
    source = 'HOUSEHOLD';
    subscription = await Subscription.findOne({ ...householdFilter, userId: household.ownerId,
      status: 'ACTIVE', startDate: { $lte: now }, endDate: { $gt: now },
    }, null, { session }).populate('planId').sort({ endDate: -1, activatedAt: -1 }) ?? history;
  } else {
    legacy = true;
    const legacyFilter = { userId: household.ownerId, ...revenueCatIndividualFilter(),
      planCode: { $in: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] },
      startDate: { $lte: now }, status: { $in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
    };
    subscription = await Subscription.findOne({ ...legacyFilter, status: 'ACTIVE', endDate: { $gt: now } }, null, { session })
      .populate('planId').sort({ endDate: -1, createdAt: -1 });
    subscription ??= await Subscription.findOne(legacyFilter, null, { session }).populate('planId').sort({ endDate: -1, createdAt: -1 });
    if (subscription) source = 'LEGACY_OWNER';
  }
  const plan = subscription?.planId;
  const limits = configuredLimits(plan, legacy);
  const codeMatches = legacy
    ? ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(subscription?.planCode)
    : ['FAMILY_MONTHLY', 'FAMILY_YEARLY'].includes(subscription?.planCode);
  const planMatches = plan && plan.planCode === subscription?.planCode
    && (legacy ? (!plan.scope || plan.scope === 'USER') : plan.scope === 'HOUSEHOLD');
  const hasPaidAccess = Boolean(subscription && codeMatches && planMatches && limits
    && String(subscription.userId) === String(household.ownerId)
    && subscription.status === 'ACTIVE' && new Date(subscription.startDate) <= now
    && new Date(subscription.endDate) > now && plan.limits.familyCloudEnabled === true);
  const hasHistory = Boolean(subscription);
  return {
    householdId: String(household._id), ownerId: String(household.ownerId), source,
    // hasPaidAccess is retained as the existing shared-feature gate, including
    // a valid free trial. New consumers can distinguish the grant via isTrial.
    subscription: subscriptionView(subscription), hasPaidAccess, hasFamilyAccess: hasPaidAccess,
    scheduledSubscription: subscriptionView(scheduledSubscription),
    isTrial: hasPaidAccess && subscription?.grantType === 'TRIAL',
    canReadSharedData: hasHistory, readOnly: hasHistory && !hasPaidAccess,
    capabilities: { familyCloudEnabled: hasPaidAccess, multiStorageEnabled: hasPaidAccess && Boolean(limits?.multiStorageEnabled) },
    limits,
    accessReason: hasPaidAccess ? 'ACTIVE' : hasHistory ? 'PAID_ACCESS_INACTIVE' : 'NO_PAID_HISTORY',
  };
}

export async function assertHouseholdSharedAccess(householdId: string, operation: 'VIEW' | 'EDIT', session?: mongoose.ClientSession) {
  const entitlement = await getHouseholdEntitlement(householdId, session);
  if (operation === 'VIEW' ? !entitlement.canReadSharedData : !entitlement.hasPaidAccess) throw new FamilySubscriptionError();
  return entitlement;
}

export async function getHouseholdSubscription(userId: string, householdId: string) {
  if (!mongoose.Types.ObjectId.isValid(householdId)) throw new FamilySubscriptionError('You do not have permission to access this household');
  const member = await HouseholdMember.findOne({ householdId, userId, status: 'ACTIVE' });
  if (!member) throw new FamilySubscriptionError('You do not have permission to access this household');
  const entitlement = await getHouseholdEntitlement(householdId);
  const owner = member.role === 'OWNER' && entitlement.ownerId === userId;
  if ((member.role === 'OWNER' && !owner) || (entitlement.ownerId === userId && !owner)) throw new FamilySubscriptionError('Household owner membership is inconsistent');
  const eligibility = owner ? await trialEligibility(userId, householdId, entitlement.hasPaidAccess)
    : { eligible: false, reason: 'OWNER_REQUIRED' };
  return { ...entitlement, memberPermission: member.permission, canManageSubscription: owner, trialEligibility: eligibility };
}
