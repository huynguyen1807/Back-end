import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const scanResultSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    householdId: { type: objectId, ref: 'Household' },
    scanType: { type: String, enum: ['BARCODE', 'EXPIRY_DATE', 'FOOD_IMAGE'], required: true },
    imageUrl: String,
    barcode: String,
    productName: String,
    brandName: String,
    categoryId: { type: objectId, ref: 'FoodCategory' },
    storageLocationId: { type: objectId, ref: 'StorageLocation' },
    detectedExpiryDate: Date,
    extractedText: String,
    confidenceScore: { type: Number, min: 0, max: 1 },
    candidates: [
      {
        foodName: String,
        normalizedName: String,
        categoryId: { type: objectId, ref: 'FoodCategory' },
        categoryName: String,
        confidence: { type: Number, min: 0, max: 1 },
        reason: String
      }
    ],
    warnings: [{ type: String }],
    rawResult: Schema.Types.Mixed,
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'LOW_CONFIDENCE', 'NEED_MANUAL_INPUT'],
      required: true
    }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

scanResultSchema.index({ userId: 1, createdAt: -1 });

export const ScanResult = existingModel('ScanResult', scanResultSchema, 'scan_results');
