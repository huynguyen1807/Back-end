import { Schema } from 'mongoose';

import { existingModel, timestamps } from './modelHelpers';

const subscriptionPlanSchema = new Schema(
  {
    planName: {
      type: String,
      enum: ['Free Plan', 'Premium Monthly', 'Premium Yearly', 'Family Monthly', 'Family Yearly'],
      required: true
    },
    planCode: {
      type: String,
      enum: ['FREE', 'PREMIUM_MONTHLY', 'PREMIUM_YEARLY', 'FAMILY_MONTHLY', 'FAMILY_YEARLY'],
      required: true,
      unique: true
    },
    price: { type: Number, required: true, min: 0 },
    scope: { type: String, enum: ['USER', 'HOUSEHOLD'], default: 'USER' },
    currency: { type: String, enum: ['VND', 'USD'], required: true },
    // Legacy Family rows remain readable. New Family configuration uses months;
    // Individual Free/Premium continue to require their existing day duration.
    durationDays: { type: Number, required: function (this: any) { return this.scope !== 'HOUSEHOLD' || !this.billingPeriodMonths; }, min: 0 },
    billingPeriodMonths: { type: Number, enum: [1, 12] },
    limits: {
      maxMembers: { type: Number, min: 1, default: 6, validate: Number.isInteger },
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

subscriptionPlanSchema.pre('validate', function () {
  const familyCode = ['FAMILY_MONTHLY', 'FAMILY_YEARLY'].includes(this.planCode);
  if ((this.scope === 'HOUSEHOLD') !== familyCode) this.invalidate('scope', 'Plan scope must match its plan code');
  if (this.billingPeriodMonths !== undefined) {
    const expected = this.planCode === 'FAMILY_MONTHLY' ? 1 : this.planCode === 'FAMILY_YEARLY' ? 12 : null;
    if (this.scope !== 'HOUSEHOLD' || this.billingPeriodMonths !== expected) this.invalidate('billingPeriodMonths', 'Calendar period must match the Family plan');
    if (this.durationDays !== undefined) this.invalidate('durationDays', 'A calendar Family plan cannot also use a fixed day duration');
  }
});

export const SubscriptionPlan = existingModel(
  'SubscriptionPlan',
  subscriptionPlanSchema,
  'subscription_plans'
);
