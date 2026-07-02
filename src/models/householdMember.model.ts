import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const householdMemberSchema = new Schema(
  {
    householdId: { type: objectId, ref: 'Household', required: true },
    userId: { type: objectId, ref: 'User', required: true },
    role: { type: String, enum: ['OWNER', 'MEMBER'], required: true },
    permission: {
      canViewInventory: { type: Boolean, default: true },
      canEditInventory: { type: Boolean, default: false },
      canViewShoppingList: { type: Boolean, default: true },
      canEditShoppingList: { type: Boolean, default: false },
      canInviteMember: { type: Boolean, default: false }
    },
    status: { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' },
    joinedAt: { type: Date, default: Date.now }
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false }
);

householdMemberSchema.index({ householdId: 1, userId: 1 }, { unique: true });

export const HouseholdMember = existingModel(
  'HouseholdMember',
  householdMemberSchema,
  'household_members'
);
