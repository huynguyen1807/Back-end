import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const storageLocationSchema = new Schema(
  {
    ownerType: { type: String, enum: ['USER', 'HOUSEHOLD'], required: true },
    userId: { type: objectId, ref: 'User', index: true },
    householdId: { type: objectId, ref: 'Household', index: true },
    storageName: { type: String, required: true, trim: true },
    storageType: {
      type: String,
      enum: ['REFRIGERATOR', 'OUTSIDE', 'FREEZER', 'PANTRY', 'KITCHEN_CABINET', 'CUSTOM'],
      required: true
    },
    description: String,
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  timestamps
);

export const StorageLocation = existingModel(
  'StorageLocation',
  storageLocationSchema,
  'storage_locations'
);
