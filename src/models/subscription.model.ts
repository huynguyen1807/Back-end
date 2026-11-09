import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const subscriptionSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    scope: { type: String, enum: ['USER', 'HOUSEHOLD'], default: 'USER' },
    householdId: { type: objectId, ref: 'Household', required: function (this: any) { return this.scope === 'HOUSEHOLD'; } },
    provider: { type: String, enum: ['REVENUECAT', 'PAYOS'] },
    // Missing on legacy paid rows. Trial records remain as lifetime claims.
    grantType: { type: String, enum: ['TRIAL', 'PAID'], immutable: true },
    activatedAt: Date,
    planId: { type: objectId, ref: 'SubscriptionPlan', required: true },
    planCode: {
      type: String,
      enum: ['FREE', 'PREMIUM_MONTHLY', 'PREMIUM_YEARLY', 'FAMILY_MONTHLY', 'FAMILY_YEARLY'],
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
subscriptionSchema.index({ householdId: 1, scope: 1, status: 1, endDate: -1 });
subscriptionSchema.index({ householdId: 1, activatedAt: -1 });
// Deployment descriptors only. Existing startup calls createIndexes() for every
// schema, so registering these there would write to an unapproved database on
// restart. An operator must deploy them only on an explicitly approved target.
export const FAMILY_TRIAL_INDEXES = [
  { key: { userId: 1 }, options: { name: 'unique_family_trial_owner_lifetime', unique: true,
    partialFilterExpression: { scope: 'HOUSEHOLD', grantType: 'TRIAL' } } },
  { key: { householdId: 1 }, options: { name: 'unique_family_trial_household_lifetime', unique: true,
    partialFilterExpression: { scope: 'HOUSEHOLD', grantType: 'TRIAL' } } },
] as const;

subscriptionSchema.pre('validate', function () {
  const familyCode = ['FAMILY_MONTHLY', 'FAMILY_YEARLY'].includes(this.planCode);
  if ((this.scope === 'HOUSEHOLD') !== familyCode) this.invalidate('scope', 'Subscription scope must match its plan code');
  if (this.scope === 'USER' && this.householdId) this.invalidate('householdId', 'Individual subscriptions cannot target a household');
  if (this.scope === 'HOUSEHOLD' && this.status === 'ACTIVE' && !this.activatedAt) this.invalidate('activatedAt', 'Household activation requires a verified activation date');
  if (this.grantType === 'TRIAL') {
    if (this.scope !== 'HOUSEHOLD' || this.planCode !== 'FAMILY_MONTHLY') this.invalidate('grantType', 'Trials must target a Family household');
    if (this.provider || this.autoRenew) this.invalidate('provider', 'Trials cannot have a payment provider or automatic renewal');
    if (!this.activatedAt || this.activatedAt.getTime() !== this.startDate?.getTime()
      || this.endDate?.getTime() - this.startDate?.getTime() !== 30 * 24 * 60 * 60 * 1000) {
      this.invalidate('endDate', 'A trial must last exactly 30 days from its server-confirmed activation');
    }
  } else if (this.grantType && this.scope !== 'HOUSEHOLD') {
    this.invalidate('grantType', 'Family grant types cannot be assigned to Individual subscriptions');
  }
});

export const Subscription = existingModel('Subscription', subscriptionSchema, 'subscriptions');
