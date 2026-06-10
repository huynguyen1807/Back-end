import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const mealSchema = new Schema(
  {
    mealType: { type: String, enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'], required: true },
    recipeId: { type: objectId, ref: 'Recipe' },
    recipeName: { type: String, required: true },
    imageUrl: String,
    scheduledTime: String,
    calories: { type: Number, min: 0 },
    status: { type: String, enum: ['COMPLETED', 'PREPARING', 'PENDING'], default: 'PENDING' },
    usedFoodItemIds: [{ type: objectId, ref: 'FoodItem' }]
  },
  { _id: false }
);

const mealPlanSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    planDate: { type: Date, required: true },
    goal: String,
    totalCalories: { type: Number, min: 0 },
    meals: [mealSchema],
    macroSummary: {
      carbs: { type: Number, default: 0 },
      protein: { type: Number, default: 0 },
      fat: { type: Number, default: 0 }
    },
    note: String
  },
  timestamps
);

mealPlanSchema.index({ userId: 1, planDate: 1 });

export const MealPlan = existingModel('MealPlan', mealPlanSchema, 'meal_plans');
