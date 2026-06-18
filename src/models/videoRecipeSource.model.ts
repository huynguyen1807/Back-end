import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const videoRecipeSourceSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    householdId: { type: objectId, ref: 'Household' },
    recipeId: { type: objectId, ref: 'Recipe' },
    videoUrl: { type: String, required: true },
    platform: { type: String, enum: ['YOUTUBE', 'TIKTOK', 'FACEBOOK', 'OTHER'], default: 'OTHER' },
    extractedText: String,
    extractedIngredients: [
      {
        ingredientName: String,
        quantity: Number,
        unit: String
      }
    ],
    missingIngredients: [
      {
        ingredientName: String,
        quantity: Number,
        unit: String
      }
    ],
    status: { type: String, enum: ['PROCESSING', 'SUCCESS', 'FAILED'], default: 'PROCESSING' }
  },
  { timestamps: true, versionKey: false }
);

videoRecipeSourceSchema.index({ userId: 1, createdAt: -1 });
videoRecipeSourceSchema.index({ status: 1 });

export const VideoRecipeSource = existingModel(
  'VideoRecipeSource',
  videoRecipeSourceSchema,
  'video_recipe_sources'
);
