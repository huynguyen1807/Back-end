import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const storageRuleSchema = new Schema(
  {
    categoryId: { type: objectId, ref: 'FoodCategory', required: true },
    storageType: {
      type: String,
      enum: ['REFRIGERATOR', 'OUTSIDE', 'FREEZER', 'PANTRY', 'KITCHEN_CABINET'],
      required: true
    },
    estimatedDays: { type: Number, required: true, min: 0 },
    instruction: String,
    warningMessage: String,
    priority: { type: Number, default: 0 },
    source: { type: String, enum: ['ADMIN', 'AI_SUGGESTED'], default: 'ADMIN' },
    status: {
      type: String,
      enum: ['OFFICIAL', 'PENDING_REVIEW', 'REJECTED'],
      default: 'OFFICIAL'
    },
    createdBy: { type: objectId, ref: 'User' },
    reviewedBy: { type: objectId, ref: 'User' }
  },
  timestamps
);

storageRuleSchema.index({ categoryId: 1, storageType: 1 }, { unique: true });

export const StorageRule = existingModel('StorageRule', storageRuleSchema, 'storage_rules');
