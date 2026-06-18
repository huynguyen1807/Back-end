import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const aiGeneratedDataSchema = new Schema(
  {
    dataType: {
      type: String,
      enum: ['STORAGE_RULE', 'RECIPE', 'NUTRITION_FACT', 'FOOD_CATEGORY'],
      required: true
    },
    generatedContent: { type: Schema.Types.Mixed, required: true },
    source: {
      type: String,
      enum: ['AI_RECOMMENDATION_SERVICE'],
      default: 'AI_RECOMMENDATION_SERVICE'
    },
    status: {
      type: String,
      enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
      default: 'PENDING_REVIEW'
    },
    reviewedBy: { type: objectId, ref: 'User' },
    reviewNote: String,
    reviewedAt: Date
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

aiGeneratedDataSchema.index({ dataType: 1, status: 1 });

export const AIGeneratedData = existingModel(
  'AIGeneratedData',
  aiGeneratedDataSchema,
  'ai_generated_data'
);
