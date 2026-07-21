import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const nutritionFactSchema = new Schema(
  {
    foodName: { type: String, required: true, trim: true },
    aliases: [{ type: String, trim: true }],
    categoryId: { type: objectId, ref: 'FoodCategory', required: true },
    caloriesPerUnit: { type: Number, required: true, min: 0 },
    baseQuantity: { type: Number, required: true, min: 0.01, default: 100 },
    unit: { type: String, enum: ['g', 'kg', 'ml', 'l', 'item', 'serving', 'quả', 'cái'], required: true },
    protein: { type: Number, default: 0, min: 0 },
    carbs: { type: Number, default: 0, min: 0 },
    fat: { type: Number, default: 0, min: 0 },
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

nutritionFactSchema.index({ foodName: 'text' });
nutritionFactSchema.index({ categoryId: 1 });

export const NutritionFact = existingModel('NutritionFact', nutritionFactSchema, 'nutrition_facts');
