import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const foodItemSchema = new Schema(
  {
    ownerType: { type: String, enum: ['USER', 'HOUSEHOLD'], required: true },
    userId: { type: objectId, ref: 'User' },
    householdId: { type: objectId, ref: 'Household' },
    categoryId: { type: objectId, ref: 'FoodCategory', required: true },
    storageLocationId: { type: objectId, ref: 'StorageLocation', required: true },
    foodName: { type: String, required: true, trim: true },
    imageUrl: String,
    sourceType: { type: String, enum: ['SUPERMARKET', 'MARKET'], required: true },
    expiryType: { type: String, enum: ['SCANNED', 'AI_PREDICTED', 'MANUAL'], required: true },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    nutritionSnapshot: {
      calories: { type: Number, min: 0 },
      protein: { type: Number, min: 0 },
      carbs: { type: Number, min: 0 },
      fat: { type: Number, min: 0 },
      baseQuantity: { type: Number, min: 0.01 },
      unit: String,
      source: { type: String, enum: ['SCAN_AI', 'ADMIN', 'CATEGORY_ESTIMATE'] },
      confidence: { type: Number, min: 0, max: 1 },
      capturedAt: Date
    },
    status: {
      type: String,
      enum: ['SAFE', 'NEAR_EXPIRY', 'EXPIRED', 'NEED_CHECK'],
      default: 'SAFE'
    },
    freshnessScore: { type: Number, min: 0, max: 100 },
    scanResultId: { type: objectId, ref: 'ScanResult' },
    aiPredictionId: { type: objectId, ref: 'AIPrediction' },
    isConsumed: { type: Boolean, default: false },
    consumedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    createdBy: { type: objectId, ref: 'User', required: true },
    updatedBy: { type: objectId, ref: 'User' }
  },
  timestamps
);

foodItemSchema.index({ userId: 1, expiryDate: 1 });
foodItemSchema.index({ householdId: 1, expiryDate: 1 });
foodItemSchema.index({ userId: 1, status: 1 });
foodItemSchema.index({ householdId: 1, status: 1 });
foodItemSchema.index({ storageLocationId: 1 });
foodItemSchema.index({ categoryId: 1 });

export const FoodItem = existingModel('FoodItem', foodItemSchema, 'food_items');
