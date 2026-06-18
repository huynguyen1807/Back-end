import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const paymentTransactionSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    planId: { type: objectId, ref: 'SubscriptionPlan', required: true },
    subscriptionId: { type: objectId, ref: 'Subscription', required: true },
    transactionCode: { type: String, required: true, unique: true },
    gatewayTransactionId: String,
    paymentGateway: {
      type: String,
      enum: ['MOMO', 'VNPAY', 'STRIPE', 'SANDBOX'],
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ['QR', 'BANK_CARD', 'E_WALLET', 'SANDBOX'],
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

export const PaymentTransaction = existingModel(
  'PaymentTransaction',
  paymentTransactionSchema,
  'payment_transactions'
);
