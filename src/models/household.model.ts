import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const householdSchema = new Schema(
  {
    householdName: { type: String, required: true, trim: true },
    ownerId: { type: objectId, ref: 'User', required: true, index: true },
    planType: { type: String, enum: ['FREE', 'PREMIUM'], default: 'FREE' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
  },
  timestamps
);

export const Household = existingModel('Household', householdSchema, 'households');
