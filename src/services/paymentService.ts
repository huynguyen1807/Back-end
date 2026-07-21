import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { ensureDefaultSubscriptionPlans } from './subscriptionService';

const ACTIVATION_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'NON_RENEWING_PURCHASE']);

function productToPlanCode(productId: string) {
  if (productId === (process.env.REVENUECAT_MONTHLY_PRODUCT_ID ?? 'monthly')) return 'PREMIUM_MONTHLY';
  if (productId === (process.env.REVENUECAT_YEARLY_PRODUCT_ID ?? 'yearly')) return 'PREMIUM_YEARLY';
  return null;
}

function hasPremiumEntitlement(event: any) {
  const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID ?? 'premium';
  const ids = event.entitlement_ids ?? [];
  return !Array.isArray(ids) || ids.length === 0 || ids.includes(entitlementId);
}

function eventDate(milliseconds: unknown, fallback = new Date()) {
  const numeric = Number(milliseconds);
  return Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : fallback;
}

export function verifyRevenueCatAuthorization(authorization?: string) {
  const configured = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!configured) throw new Error('REVENUECAT_WEBHOOK_AUTH is not configured');
  const expected = configured.startsWith('Bearer ') ? configured : `Bearer ${configured}`;
  if (authorization !== expected) throw new Error('Invalid RevenueCat webhook authorization');
}

export async function processRevenueCatWebhook(payload: any) {
  const event = payload?.event;
  if (!event?.id || !event?.type) throw new Error('Invalid RevenueCat webhook payload');
  if (event.type === 'TEST') return { acknowledged: true };
  if (await PaymentTransaction.exists({ revenueCatEventId: event.id })) return { acknowledged: true, duplicate: true };

  const userId = event.app_user_id;
  if (!userId) throw new Error('RevenueCat event has no app_user_id');

  if (event.type === 'EXPIRATION') {
    await Subscription.updateMany({ userId, status: 'ACTIVE' }, { status: 'EXPIRED', autoRenew: false });
    return { acknowledged: true };
  }
  if (event.type === 'CANCELLATION' || event.type === 'BILLING_ISSUE') {
    await Subscription.updateMany({ userId, status: 'ACTIVE' }, { autoRenew: false });
    return { acknowledged: true };
  }
  if (!ACTIVATION_EVENTS.has(event.type) || !hasPremiumEntitlement(event)) return { acknowledged: true };

  await ensureDefaultSubscriptionPlans();
  const planCode = productToPlanCode(event.product_id);
  if (!planCode) throw new Error(`Unknown RevenueCat product: ${event.product_id}`);
  const plan = await SubscriptionPlan.findOne({ planCode, isActive: true });
  if (!plan) throw new Error('Subscription plan not found');

  const startDate = eventDate(event.purchased_at_ms);
  const fallbackEnd = new Date(startDate);
  fallbackEnd.setDate(fallbackEnd.getDate() + plan.durationDays);
  const endDate = eventDate(event.expiration_at_ms, fallbackEnd);

  await Subscription.updateMany(
    { userId, status: 'ACTIVE', planCode: { $ne: planCode } },
    { status: 'CANCELLED', autoRenew: false }
  );
  const subscription = await Subscription.findOneAndUpdate(
    { userId, status: 'ACTIVE', planCode },
    { userId, planId: plan._id, planCode, status: 'ACTIVE', startDate, endDate, autoRenew: event.type !== 'NON_RENEWING_PURCHASE' },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  if (['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'].includes(event.type)) {
    await PaymentTransaction.create({
      userId, planId: plan._id, subscriptionId: subscription!._id,
      transactionCode: `RC-${event.id}`, revenueCatEventId: event.id,
      gatewayTransactionId: event.transaction_id ?? event.original_transaction_id,
      productId: event.product_id, paymentGateway: 'REVENUECAT', paymentMethod: 'IN_APP_PURCHASE',
      amount: plan.price, currency: plan.currency, status: 'SUCCESS', paidAt: startDate, callbackData: event
    });
  }
  return { acknowledged: true };
}

export async function getPaymentHistory(userId: string) {
  return PaymentTransaction.find({ userId })
    .populate('planId', 'planName planCode price currency durationDays')
    .populate('subscriptionId', 'planCode status startDate endDate')
    .sort({ createdAt: -1 });
}
