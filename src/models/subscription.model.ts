import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const subscriptionSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    planId: { type: objectId, ref: 'SubscriptionPlan', required: true },
    planCode: {
      type: String,
      enum: ['FREE', 'PREMIUM_MONTHLY', 'PREMIUM_YEARLY'],
      required: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING'],
      default: 'PENDING'
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    autoRenew: { type: Boolean, default: false }
  },
  timestamps
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ userId: 1, endDate: 1 });

export const Subscription = existingModel('Subscription', subscriptionSchema, 'subscriptions');
