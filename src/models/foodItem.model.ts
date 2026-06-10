import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const foodItemSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    categoryId: { type: objectId, ref: 'FoodCategory', required: true, index: true },
    storageLocationId: { type: objectId, ref: 'StorageLocation', required: true, index: true },
    foodName: { type: String, required: true, trim: true },
    imageUrl: String,
    sourceType: { type: String, enum: ['SUPERMARKET', 'MARKET'], required: true },
    expiryType: { type: String, enum: ['SCANNED', 'AI_PREDICTED', 'MANUAL'], required: true },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    status: {
      type: String,
      enum: ['SAFE', 'NEAR_EXPIRY', 'EXPIRED', 'NEED_CHECK'],
      default: 'SAFE'
    },
    freshnessScore: { type: Number, min: 0, max: 100 },
    scanResultId: { type: objectId, ref: 'ScanResult' },
    aiPredictionId: { type: objectId, ref: 'AIPrediction' },
    isConsumed: { type: Boolean, default: false },
    consumedAt: Date
  },
  timestamps
);

foodItemSchema.index({ userId: 1, expiryDate: 1 });
foodItemSchema.index({ userId: 1, status: 1 });
foodItemSchema.index({ userId: 1, storageLocationId: 1 });
foodItemSchema.index({ userId: 1, categoryId: 1 });

export const FoodItem = existingModel('FoodItem', foodItemSchema, 'food_items');
