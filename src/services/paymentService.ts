import crypto from 'crypto';

import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { ensureDefaultSubscriptionPlans } from './subscriptionService';

function buildTransactionCode() {
  return `SANDBOX-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getSubscriptionDates(durationDays: number) {
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + Math.max(durationDays, 1));

  return { startDate, endDate };
}

export async function createSandboxPayment(userId: string, data: any) {
  await ensureDefaultSubscriptionPlans();

  const planCode = data.planCode;
  if (!['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(planCode)) {
    throw new Error('planCode must be PREMIUM_MONTHLY or PREMIUM_YEARLY');
  }

  const plan = await SubscriptionPlan.findOne({ planCode, isActive: true });
  if (!plan) {
    throw new Error('Subscription plan not found');
  }

  const { startDate, endDate } = getSubscriptionDates(plan.durationDays);

  const subscription = await Subscription.create({
    userId,
    planId: plan._id,
    planCode: plan.planCode,
    status: 'PENDING',
    startDate,
    endDate,
    autoRenew: false
  });

  const transactionCode = buildTransactionCode();
  const transaction = await PaymentTransaction.create({
    userId,
    planId: plan._id,
    subscriptionId: subscription._id,
    transactionCode,
    paymentGateway: 'SANDBOX',
    paymentMethod: 'SANDBOX',
    amount: plan.price,
    currency: plan.currency,
    status: 'PENDING',
    paymentUrl: `/api/payments/sandbox-success/${transactionCode}`
  });

  return { subscription, transaction, paymentUrl: transaction.paymentUrl };
}

export async function markSandboxPaymentSuccess(userId: string, transactionCode: string) {
  const transaction = await PaymentTransaction.findOne({
    userId,
    transactionCode,
    status: 'PENDING'
  });

  if (!transaction) {
    throw new Error('Payment transaction not found');
  }

  const subscription = await Subscription.findOne({
    _id: transaction.subscriptionId,
    userId,
    status: 'PENDING'
  });

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  await Subscription.updateMany(
    {
      userId,
      status: 'ACTIVE',
      _id: { $ne: subscription._id }
    },
    { status: 'CANCELLED', autoRenew: false }
  );

  transaction.status = 'SUCCESS';
  transaction.paidAt = new Date();
  transaction.callbackData = { sandbox: true };
  await transaction.save();

  subscription.status = 'ACTIVE';
  subscription.startDate = transaction.paidAt;
  await subscription.save();

  return { subscription, transaction };
}

export async function getPaymentHistory(userId: string) {
  return PaymentTransaction.find({ userId })
    .populate('planId', 'planName planCode price currency durationDays')
    .populate('subscriptionId', 'planCode status startDate endDate')
    .sort({ createdAt: -1 });
}
