import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const householdInvitationSchema = new Schema(
  {
    householdId: { type: objectId, ref: 'Household', required: true },
    invitedBy: { type: objectId, ref: 'User', required: true },
    inviteEmail: { type: String, required: true, trim: true, lowercase: true },
    inviteToken: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED'],
      default: 'PENDING'
    },
    expiresAt: { type: Date, required: true }
  },
  timestamps
);

householdInvitationSchema.index({ inviteEmail: 1, status: 1 });

export const HouseholdInvitation = existingModel(
  'HouseholdInvitation',
  householdInvitationSchema,
  'household_invitations'
);
