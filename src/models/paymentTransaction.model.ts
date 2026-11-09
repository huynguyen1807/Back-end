import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const paymentTransactionSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    planId: { type: objectId, ref: 'SubscriptionPlan', required: true },
    subscriptionId: { type: objectId, ref: 'Subscription', required: function (this: any) { return this.paymentGateway !== 'PAYOS' || this.status === 'SUCCESS'; } },
    householdId: { type: objectId, ref: 'Household', required: function (this: any) { return this.paymentGateway === 'PAYOS'; } },
    orderCode: { type: Number, min: 1, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger, required: function (this: any) { return this.paymentGateway === 'PAYOS'; } },
    paymentLinkId: String,
    planCode: { type: String, enum: ['FAMILY_MONTHLY', 'FAMILY_YEARLY'], required: function (this: any) { return this.paymentGateway === 'PAYOS'; } },
    durationDays: { type: Number, min: 1, validate: Number.isSafeInteger, required: function (this: any) { return this.paymentGateway === 'PAYOS' && !this.billingPeriodMonths; } },
    billingPeriodMonths: { type: Number, enum: [1, 12] },
    providerStatus: { type: String, enum: ['PENDING', 'CANCELLED', 'UNDERPAID', 'PAID', 'EXPIRED', 'PROCESSING', 'FAILED'] },
    entitlementAppliedAt: Date,
    transactionCode: { type: String, required: true, unique: true },
    revenueCatEventId: { type: String, unique: true, sparse: true },
    productId: String,
    gatewayTransactionId: String,
    paymentGateway: {
      type: String,
      enum: ['REVENUECAT', 'PAYOS', 'MOMO', 'VNPAY', 'STRIPE', 'SANDBOX'],
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ['IN_APP_PURCHASE', 'BANK_TRANSFER', 'BANK_CARD', 'E_WALLET', 'SANDBOX'],
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['VND', 'USD'], required: true },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'],
      required: true
    },
    paymentUrl: String,
    callbackData: Schema.Types.Mixed,
    paidAt: Date
  },
  timestamps
);

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });
paymentTransactionSchema.index({ orderCode: 1 }, { unique: true, sparse: true });
paymentTransactionSchema.index({ paymentLinkId: 1 }, { unique: true, sparse: true });
paymentTransactionSchema.index({ householdId: 1 }, {
  name: 'unique_pending_payos_checkout_per_household', unique: true,
  partialFilterExpression: { paymentGateway: 'PAYOS', status: 'PENDING' },
});

paymentTransactionSchema.pre('validate', function () {
  if (this.paymentGateway !== 'PAYOS') return;
  if (this.billingPeriodMonths !== undefined && this.billingPeriodMonths !== (this.planCode === 'FAMILY_MONTHLY' ? 1 : 12)) this.invalidate('billingPeriodMonths', 'Calendar period must match the Family plan');
  if (this.currency !== 'VND' || !Number.isSafeInteger(this.amount) || this.amount <= 0) this.invalidate('amount', 'payOS requires a positive integer VND amount');
  if (this.status === 'SUCCESS' && !this.entitlementAppliedAt) this.invalidate('entitlementAppliedAt', 'Successful payOS payments must have an applied entitlement');
});

export const PaymentTransaction = existingModel(
  'PaymentTransaction',
  paymentTransactionSchema,
  'payment_transactions'
);
