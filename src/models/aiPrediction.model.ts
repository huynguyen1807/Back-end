import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const aiPredictionSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    foodName: { type: String, required: true, trim: true },
    categoryId: { type: objectId, ref: 'FoodCategory', required: true },
    storageLocationId: { type: objectId, ref: 'StorageLocation', required: true },
    purchaseDate: { type: Date, required: true },
    predictedExpiryDate: { type: Date, required: true },
    estimatedDays: { type: Number, required: true, min: 0 },
    confidenceScore: { type: Number, min: 0, max: 1 },
    explanation: String,
    source: { type: String, enum: ['AI_PREDICTED'], default: 'AI_PREDICTED' },
    status: {
      type: String,
      enum: ['PENDING_REVIEW', 'ACCEPTED_BY_USER', 'REJECTED_BY_USER'],
      default: 'PENDING_REVIEW'
    }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const AIPrediction = existingModel('AIPrediction', aiPredictionSchema, 'ai_predictions');
