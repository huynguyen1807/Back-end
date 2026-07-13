import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { Subscription } from '../models/subscription.model';

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
    price: 490000,
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
        { ...plan, isActive: true },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      )
    )
  );
};

export const getAllSubscriptionPlans = async () => {
  await ensureDefaultSubscriptionPlans();
  return await SubscriptionPlan.find({ isActive: true });
};

export const getUserCurrentSubscription = async (userId: string) => {
  await ensureDefaultSubscriptionPlans();

  // Find the active subscription that hasn't expired
  const currentSubscription = await Subscription.findOne({
    userId,
    status: 'ACTIVE',
    endDate: { $gt: new Date() }
  }).populate('planId');

  if (!currentSubscription) {
    // If no active premium, return the free plan as default
    const freePlan = await SubscriptionPlan.findOne({ planCode: 'FREE' });
    return {
      planCode: 'FREE',
      planId: freePlan,
      status: 'ACTIVE',
      isPremium: false,
      limits: freePlan?.limits
    };
  }

  return {
    ...currentSubscription.toObject(),
    isPremium: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(currentSubscription.planCode),
    // @ts-ignore
    limits: currentSubscription.planId?.limits
  };
};

export const userHasActivePremium = async (userId: string) => {
  const currentSubscription = await getUserCurrentSubscription(userId);
  return Boolean(currentSubscription.isPremium && currentSubscription.limits?.familyCloudEnabled);
};
