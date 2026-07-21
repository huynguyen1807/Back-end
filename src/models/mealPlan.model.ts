import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const usedFoodSchema = new Schema(
  {
    foodItemId: { type: objectId, ref: 'FoodItem', required: true },
    foodName: { type: String, required: true },
    quantityUsed: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    calories: { type: Number, default: 0, min: 0 },
    macroSummary: {
      protein: { type: Number, default: 0, min: 0 },
      carbs: { type: Number, default: 0, min: 0 },
      fat: { type: Number, default: 0, min: 0 }
    }
  },
  { _id: false }
);

const mealSchema = new Schema(
  {
    mealType: {
      type: String,
      enum: ['BREAKFAST', 'LUNCH', 'AFTERNOON', 'DINNER', 'LATE_NIGHT', 'SNACK'],
      required: true
    },
    recipeId: { type: objectId, ref: 'Recipe' },
    recipeName: { type: String, required: true },
    imageUrl: String,
    scheduledTime: String,
    calories: { type: Number, min: 0 },
    macroSummary: {
      protein: { type: Number, default: 0, min: 0 },
      carbs: { type: Number, default: 0, min: 0 },
      fat: { type: Number, default: 0, min: 0 }
    },
    status: { type: String, enum: ['COMPLETED', 'PREPARING', 'PENDING'], default: 'PENDING' },
    usedFoodItemIds: [{ type: objectId, ref: 'FoodItem' }],
    usedFoods: [usedFoodSchema],
    inventoryApplied: { type: Boolean, default: false }
  },
  { _id: false }
);

const mealPlanSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    inventoryOwnerType: { type: String, enum: ['USER', 'HOUSEHOLD'], default: 'USER' },
    householdId: { type: objectId, ref: 'Household' },
    planDate: { type: Date, required: true },
    goal: String,
    totalCalories: { type: Number, min: 0 },
    meals: [mealSchema],
    macroSummary: {
      carbs: { type: Number, default: 0 },
      protein: { type: Number, default: 0 },
      fat: { type: Number, default: 0 }
    },
    generatedBy: { type: String, enum: ['USER', 'AI'], default: 'USER' },
    note: String
  },
  timestamps
);

mealPlanSchema.index({ userId: 1, planDate: 1 });
mealPlanSchema.index({ householdId: 1, planDate: 1 });

export const MealPlan = existingModel('MealPlan', mealPlanSchema, 'meal_plans');
