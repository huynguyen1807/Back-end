import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const nutritionFactSchema = new Schema(
  {
    foodName: { type: String, required: true, trim: true, index: true },
    categoryId: { type: objectId, ref: 'FoodCategory', required: true, index: true },
    caloriesPerUnit: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['g', 'ml', 'item'], required: true },
    protein: { type: Number, default: 0, min: 0 },
    carbs: { type: Number, default: 0, min: 0 },
    fat: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: ['ADMIN', 'AI_SUGGESTED'], default: 'ADMIN' },
    status: { type: String, enum: ['OFFICIAL', 'PENDING_REVIEW'], default: 'OFFICIAL' }
  },
  timestamps
);

export const NutritionFact = existingModel('NutritionFact', nutritionFactSchema, 'nutrition_facts');
