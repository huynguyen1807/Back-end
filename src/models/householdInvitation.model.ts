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
householdInvitationSchema.index({ inviteEmail: 1 }, {
  name: 'unique_pending_family_invitation_per_email', unique: true,
  partialFilterExpression: { status: 'PENDING' },
});

export const HouseholdInvitation = existingModel(
  'HouseholdInvitation',
  householdInvitationSchema,
  'household_invitations'
);
