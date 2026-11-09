import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { ensureDefaultSubscriptionPlans, revenueCatIndividualFilter } from './subscriptionService';
import mongoose from 'mongoose';
import { randomInt } from 'node:crypto';
import { Household } from '../models/household.model';
import { HouseholdMember } from '../models/householdMember.model';
import { getPayOS, getPayOSReturnUrls } from '../config/payos';
import type { PaymentLink, WebhookData } from '@payos/node';
import { addFamilyCalendarMonths } from '../utils/familyBillingPeriod';

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

function useRealDurationForSandbox(event: any) {
  return (
    process.env.REVENUECAT_SANDBOX_USE_REAL_DURATION === 'true' &&
    event.environment === 'SANDBOX'
  );
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
  const keepRealSandboxDuration = useRealDurationForSandbox(event);

  // Test Store renews monthly products every 5 minutes and yearly products every hour.
  // In demo mode, the initial purchase grants the configured 30/365 days and accelerated
  // sandbox lifecycle events must not shorten or repeatedly extend that local entitlement.
  if (
    keepRealSandboxDuration &&
    ['RENEWAL', 'SUBSCRIPTION_EXTENDED', 'UNCANCELLATION', 'EXPIRATION'].includes(event.type)
  ) {
    return { acknowledged: true, sandboxLifecycleIgnored: true };
  }

  if (event.type === 'EXPIRATION') {
    await Subscription.updateMany({ userId, ...revenueCatIndividualFilter(), status: 'ACTIVE' }, { status: 'EXPIRED', autoRenew: false });
    return { acknowledged: true };
  }
  if (event.type === 'CANCELLATION' || event.type === 'BILLING_ISSUE') {
    await Subscription.updateMany({ userId, ...revenueCatIndividualFilter(), status: 'ACTIVE' }, { autoRenew: false });
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
  const endDate = keepRealSandboxDuration
    ? fallbackEnd
    : eventDate(event.expiration_at_ms, fallbackEnd);

  await Subscription.updateMany(
    { userId, ...revenueCatIndividualFilter(), status: 'ACTIVE', planCode: { $ne: planCode } },
    { status: 'CANCELLED', autoRenew: false }
  );
  const subscription = await Subscription.findOneAndUpdate(
    { userId, ...revenueCatIndividualFilter(), status: 'ACTIVE', planCode },
    { userId, scope: 'USER', provider: 'REVENUECAT', planId: plan._id, planCode, status: 'ACTIVE', startDate, endDate, autoRenew: event.type !== 'NON_RENEWING_PURCHASE' },
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

export class PayOSPaymentError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'PayOSPaymentError';
  }
}

function validOrderCode(value: unknown) {
  if (!((typeof value === 'number') || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))) throw new PayOSPaymentError('Invalid orderCode', 400);
  const orderCode = Number(value);
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) throw new PayOSPaymentError('Invalid orderCode', 400);
  return orderCode;
}

function paymentView(payment: any) {
  return {
    orderCode: payment.orderCode, transactionCode: payment.transactionCode,
    householdId: String(payment.householdId), planCode: payment.planCode,
    amount: payment.amount, currency: payment.currency, status: payment.status,
    providerStatus: payment.providerStatus, checkoutUrl: payment.paymentUrl ?? null,
    subscriptionId: payment.subscriptionId ? String(payment.subscriptionId) : null,
    paidAt: payment.paidAt, awaitingProvider: payment.status === 'PENDING' && !payment.paymentUrl,
  };
}

async function requireHouseholdOwner(userId: string, householdId: string, session?: mongoose.ClientSession, lock = false) {
  if (!mongoose.Types.ObjectId.isValid(householdId)) throw new PayOSPaymentError('Invalid householdId', 400);
  const query = { _id: householdId, ownerId: userId, status: 'ACTIVE' };
  const household = lock
    ? await Household.findOneAndUpdate(query, { $inc: { membershipRevision: 1 } }, { session, returnDocument: 'after' })
    : await Household.findOne(query, null, { session });
  const member = await HouseholdMember.findOne({ householdId, userId, role: 'OWNER', status: 'ACTIVE' }, null, { session });
  if (!household || !member) throw new PayOSPaymentError('Only the active Household Owner can manage this payment', 403);
  return household;
}

async function activeFamilySubscription(householdId: string, session: mongoose.ClientSession) {
  const now = new Date();
  return Subscription.findOne({ scope: 'HOUSEHOLD', householdId, status: 'ACTIVE', grantType: { $ne: 'TRIAL' },
    activatedAt: { $lte: now }, endDate: { $gt: now },
  }, null, { session }).sort({ endDate: -1 });
}

function assertSameActivePlan(current: any, planCode: string, userId: string) {
  if (current && (current.planCode !== planCode || current.provider !== 'PAYOS' || String(current.userId) !== userId)) {
    throw new PayOSPaymentError('Changing an active Family plan or its provider is not supported', 409);
  }
}

function assertCheckoutPlan(plan: any) {
  const limits = plan?.limits;
  if (!plan || plan.scope !== 'HOUSEHOLD' || !['FAMILY_MONTHLY', 'FAMILY_YEARLY'].includes(plan.planCode)
    || plan.currency !== 'VND' || !Number.isSafeInteger(plan.price) || plan.price <= 0
    || (plan.billingPeriodMonths !== undefined && plan.billingPeriodMonths !== (plan.planCode === 'FAMILY_MONTHLY' ? 1 : 12))
    || limits?.familyCloudEnabled !== true || !Number.isInteger(limits.maxMembers) || limits.maxMembers < 1
    || !Number.isInteger(limits.maxFoodItems) || limits.maxFoodItems < 0
    || !Number.isInteger(limits.maxStorageLocations) || limits.maxStorageLocations < 0) {
    throw new PayOSPaymentError('Family plan is unavailable or not fully configured for VND checkout', 400);
  }
}

export async function createPayOSCheckout(userId: string, input: { householdId?: unknown; planCode?: unknown }) {
  if (typeof input.householdId !== 'string' || typeof input.planCode !== 'string') throw new PayOSPaymentError('householdId and planCode are required', 400);
  const { householdId, planCode } = input;
  await requireHouseholdOwner(userId, householdId);
  const client = getPayOS();
  const orderCode = randomInt(1, 2 ** 48 - 1);
  const urls = getPayOSReturnUrls(orderCode);
  const pending = await PaymentTransaction.findOne({ paymentGateway: 'PAYOS', householdId, status: 'PENDING' });
  if (pending) {
    const refreshed = await getPayOSPaymentStatus(userId, pending.orderCode);
    if (refreshed.status === 'PENDING' || refreshed.status === 'SUCCESS') return refreshed;
  }
  let payment: any;
  try {
    payment = await mongoose.connection.transaction(async (session) => {
      await requireHouseholdOwner(userId, householdId, session, true);
      const plan = await SubscriptionPlan.findOne({ planCode, scope: 'HOUSEHOLD', isActive: true }, null, { session });
      assertCheckoutPlan(plan);
      assertSameActivePlan(await activeFamilySubscription(householdId, session), planCode, userId);
      const [created] = await PaymentTransaction.create([{
        userId, householdId, planId: plan._id, planCode: plan.planCode,
        billingPeriodMonths: plan.billingPeriodMonths ?? (plan.planCode === 'FAMILY_MONTHLY' ? 1 : 12),
        orderCode, transactionCode: `PO-${orderCode}`, paymentGateway: 'PAYOS', paymentMethod: 'BANK_TRANSFER',
        amount: plan.price, currency: plan.currency, status: 'PENDING',
      }], { session });
      return created;
    });
  } catch (error: any) {
    if (error?.code === 11000) throw new PayOSPaymentError('A checkout already exists; refresh its payment status', 409);
    throw error;
  }
  let link;
  try {
    link = await client.paymentRequests.create({ orderCode, amount: payment.amount,
      description: `FF ${orderCode}`, ...urls,
    });
  } catch (error: any) {
    // A timeout/connection failure is ambiguous: the remote order may exist.
    // Keep it pending and reconcile by orderCode, never create a second link.
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)) {
      await PaymentTransaction.updateOne({ _id: payment._id, status: 'PENDING', entitlementAppliedAt: { $exists: false } }, { status: 'FAILED' });
    }
    throw new PayOSPaymentError('Unable to create checkout; refresh payment status before retrying', 503);
  }
  if (link.orderCode !== orderCode || link.amount !== payment.amount || link.currency !== 'VND'
    || !link.paymentLinkId || !/^https:\/\//.test(link.checkoutUrl)) {
    throw new PayOSPaymentError('Invalid payOS checkout response; payment remains pending', 502);
  }
  // Do not downgrade a payment if its webhook arrived before this response.
  const linked = await PaymentTransaction.updateOne({ _id: payment._id,
    $or: [{ paymentLinkId: { $exists: false } }, { paymentLinkId: link.paymentLinkId }],
  }, { $set: { paymentLinkId: link.paymentLinkId, paymentUrl: link.checkoutUrl } });
  if (!linked.matchedCount) throw new PayOSPaymentError('Checkout identity changed; refresh payment status', 409);
  const saved = await PaymentTransaction.findOne({ _id: payment._id });
  return paymentView(saved);
}

function assertProviderIdentity(payment: any, remote: PaymentLink, signed?: WebhookData) {
  if (remote.orderCode !== payment.orderCode || remote.amount !== payment.amount || !remote.id
    || (payment.paymentLinkId && payment.paymentLinkId !== remote.id)
    || (signed && (signed.orderCode !== payment.orderCode || signed.paymentLinkId !== remote.id
      || signed.amount !== payment.amount || signed.currency !== payment.currency))) {
    throw new PayOSPaymentError('Invalid payment identity or amount', 400);
  }
  if (remote.status === 'PAID' && (remote.amountPaid !== payment.amount || remote.amountRemaining !== 0)) {
    throw new PayOSPaymentError('Invalid paid amount', 400);
  }
}

async function applyVerifiedPayOSResult(orderCode: number, remote: PaymentLink, signed?: WebhookData) {
  return mongoose.connection.transaction(async (session) => {
    const payment = await PaymentTransaction.findOne({ paymentGateway: 'PAYOS', orderCode }, null, { session });
    if (!payment) throw new PayOSPaymentError('Payment not found', 404);
    assertProviderIdentity(payment, remote, signed);
    if (payment.status === 'SUCCESS' || payment.status === 'REFUNDED' || payment.entitlementAppliedAt) return paymentView(payment);
    if (remote.status !== 'PAID') {
      const status = remote.status === 'FAILED' ? 'FAILED'
        : ['CANCELLED', 'EXPIRED'].includes(remote.status) ? 'CANCELLED' : 'PENDING';
      // Older non-success observations must not resurrect a terminal order.
      if (payment.status === 'PENDING') payment.status = status;
      payment.providerStatus = remote.status;
      await payment.save({ session });
      return paymentView(payment);
    }
    const householdId = String(payment.householdId);
    await requireHouseholdOwner(String(payment.userId), householdId, session, true);
    const active = await activeFamilySubscription(householdId, session);
    assertSameActivePlan(active, payment.planCode, String(payment.userId));
    const current = active ?? await Subscription.findOne({ scope: 'HOUSEHOLD', householdId,
      userId: payment.userId, provider: 'PAYOS', planCode: payment.planCode, grantType: { $ne: 'TRIAL' }, activatedAt: { $lte: new Date() },
    }, null, { session }).sort({ endDate: -1 });
    const now = new Date();
    const previousEnd = current?.endDate ? new Date(current.endDate).getTime() : 0;
    const trial = await Subscription.findOne({ scope: 'HOUSEHOLD', householdId, userId: payment.userId, grantType: 'TRIAL',
      status: 'ACTIVE', startDate: { $lte: now }, endDate: { $gt: now }, activatedAt: { $lte: now },
    }, null, { session }).sort({ endDate: -1 });
    const periodStart = new Date(Math.max(now.getTime(), previousEnd, trial?.endDate ? new Date(trial.endDate).getTime() : 0));
    // Old pending orders retain their plan identity; Family billing uses that
    // plan's calendar period, never converts its historical day count.
    const months = payment.billingPeriodMonths ?? (payment.planCode === 'FAMILY_MONTHLY' ? 1 : 12);
    const endDate = addFamilyCalendarMonths(periodStart, months);
    let subscription = current;
    if (subscription) {
      subscription.planId = payment.planId;
      subscription.status = 'ACTIVE'; subscription.endDate = endDate;
      if (previousEnd <= now.getTime()) subscription.startDate = periodStart;
      subscription.autoRenew = false;
      await subscription.save({ session });
    } else {
      [subscription] = await Subscription.create([{
        userId: payment.userId, householdId, scope: 'HOUSEHOLD', provider: 'PAYOS', activatedAt: now,
        planId: payment.planId, planCode: payment.planCode, grantType: 'PAID', status: 'ACTIVE', startDate: periodStart, endDate, autoRenew: false,
      }], { session });
    }
    payment.subscriptionId = subscription._id; payment.status = 'SUCCESS'; payment.providerStatus = 'PAID';
    payment.paymentLinkId = remote.id; payment.entitlementAppliedAt = now; payment.paidAt = now;
    payment.gatewayTransactionId = signed?.reference;
    payment.callbackData = { reference: signed?.reference, providerTransactionDateTime: signed?.transactionDateTime };
    await payment.save({ session });
    return paymentView(payment);
  });
}

async function retrievePayOSPayment(payment: any, signed?: WebhookData) {
  let remote;
  try { remote = await getPayOS().paymentRequests.get(payment.orderCode); }
  catch (error: any) {
    if (error?.status === 404 && !signed) return paymentView(payment);
    throw new PayOSPaymentError('Unable to verify payOS payment status', 503);
  }
  assertProviderIdentity(payment, remote, signed);
  return applyVerifiedPayOSResult(payment.orderCode, remote, signed);
}

export async function processPayOSWebhook(payload: unknown) {
  const client = getPayOS();
  let signed: WebhookData;
  try { signed = await client.webhooks.verify(payload as any); }
  catch { throw new PayOSPaymentError('Invalid payOS webhook signature', 400); }
  if (signed.code !== '00') return { acknowledged: true, ignored: true };
  const orderCode = validOrderCode(signed.orderCode);
  const payment = await PaymentTransaction.findOne({ paymentGateway: 'PAYOS', orderCode });
  // Merchant webhook registration probes and unrelated merchant orders may be
  // correctly signed. Acknowledge them without creating any local records.
  if (!payment) return { acknowledged: true, ignored: true };
  if (signed.amount !== payment.amount || signed.currency !== payment.currency || !signed.paymentLinkId
    || (payment.paymentLinkId && payment.paymentLinkId !== signed.paymentLinkId)) throw new PayOSPaymentError('Invalid payment identity or amount', 400);
  if (payment.entitlementAppliedAt || payment.status === 'SUCCESS' || payment.status === 'REFUNDED') return { acknowledged: true, duplicate: true };
  await retrievePayOSPayment(payment, signed);
  return { acknowledged: true };
}

export async function getPayOSPaymentStatus(userId: string, value: unknown) {
  const orderCode = validOrderCode(value);
  const payment = await PaymentTransaction.findOne({ paymentGateway: 'PAYOS', orderCode, userId });
  if (!payment) throw new PayOSPaymentError('Payment not found', 404);
  await requireHouseholdOwner(userId, String(payment.householdId));
  if (payment.status === 'SUCCESS' || payment.status === 'REFUNDED' || payment.entitlementAppliedAt) return paymentView(payment);
  return retrievePayOSPayment(payment);
}
