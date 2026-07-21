import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const recipeRecommendationStateSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    recipeId: { type: objectId, ref: 'Recipe', required: true },
    status: { type: String, enum: ['DISMISSED'], required: true },
  },
  timestamps,
);

recipeRecommendationStateSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
recipeRecommendationStateSchema.index({ userId: 1, status: 1 });

export const RecipeRecommendationState = existingModel(
  'RecipeRecommendationState',
  recipeRecommendationStateSchema,
  'recipe_recommendation_states',
);
