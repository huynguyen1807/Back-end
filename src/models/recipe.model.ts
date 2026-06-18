import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const recipeIngredientSchema = new Schema(
  {
    ingredientName: { type: String, required: true },
    categoryId: { type: objectId, ref: 'FoodCategory' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    isRequired: { type: Boolean, default: true }
  },
  { _id: false }
);

const recipeSchema = new Schema(
  {
    recipeName: { type: String, required: true, trim: true },
    description: String,
    imageUrl: String,
    cookingSteps: [{ type: String }],
    cookingTime: { type: Number, min: 0 },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'EASY' },
    calories: { type: Number, min: 0 },
    macroSummary: {
      protein: { type: Number, default: 0, min: 0 },
      carbs: { type: Number, default: 0, min: 0 },
      fat: { type: Number, default: 0, min: 0 }
    },
    tags: [{ type: String }],
    ingredients: [recipeIngredientSchema],
    sourceType: {
      type: String,
      enum: ['SYSTEM', 'AI_GENERATED', 'VIDEO_EXTRACTED'],
      default: 'SYSTEM'
    },
    videoSourceId: { type: objectId, ref: 'VideoRecipeSource' },
    createdBy: { type: objectId, ref: 'User' },
    isActive: { type: Boolean, default: true }
  },
  timestamps
);

recipeSchema.index({ recipeName: 'text' });
recipeSchema.index({ tags: 1 });
recipeSchema.index({ sourceType: 1 });

export const Recipe = existingModel('Recipe', recipeSchema, 'recipes');
