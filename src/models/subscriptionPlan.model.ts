import { Schema } from 'mongoose';

import { existingModel, timestamps } from './modelHelpers';

const subscriptionPlanSchema = new Schema(
  {
    planName: {
      type: String,
      enum: ['Free Plan', 'Premium Monthly', 'Premium Yearly'],
      required: true
    },
    planCode: {
      type: String,
      enum: ['FREE', 'PREMIUM_MONTHLY', 'PREMIUM_YEARLY'],
      required: true,
      unique: true
    },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['VND', 'USD'], required: true },
    durationDays: { type: Number, required: true, min: 0 },
    limits: {
      maxStorageLocations: { type: Number, required: true, min: 0 },
      maxFoodItems: { type: Number, required: true, min: 0 },
      familyCloudEnabled: { type: Boolean, default: false },
      macroReportEnabled: { type: Boolean, default: false },
      multiStorageEnabled: { type: Boolean, default: false }
    },
    features: [{ type: String }],
    isActive: { type: Boolean, default: true }
  },
  timestamps
);

export const SubscriptionPlan = existingModel(
  'SubscriptionPlan',
  subscriptionPlanSchema,
  'subscription_plans'
);
