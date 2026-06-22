import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { Subscription } from '../models/subscription.model';

export const getAllSubscriptionPlans = async () => {
  return await SubscriptionPlan.find({ isActive: true });
};

export const getUserCurrentSubscription = async (userId: string) => {
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
