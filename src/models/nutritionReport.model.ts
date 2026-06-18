import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const dailySummarySchema = new Schema(
  {
    date: { type: Date, required: true },
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carbs: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const nutritionReportSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    householdId: { type: objectId, ref: 'Household' },
    periodType: { type: String, enum: ['WEEK', 'MONTH'], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalCalories: { type: Number, required: true, min: 0 },
    averageCalories: { type: Number, required: true, min: 0 },
    totalProtein: { type: Number, required: true, min: 0 },
    totalCarbs: { type: Number, required: true, min: 0 },
    totalFat: { type: Number, required: true, min: 0 },
    dailySummary: [dailySummarySchema],
    generatedAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

nutritionReportSchema.index({ userId: 1, periodType: 1, startDate: 1 });
nutritionReportSchema.index({ householdId: 1, periodType: 1, startDate: 1 });

export const NutritionReport = existingModel(
  'NutritionReport',
  nutritionReportSchema,
  'nutrition_reports'
);
