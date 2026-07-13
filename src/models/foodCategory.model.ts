import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const foodCategorySchema = new Schema(
  {
    categoryName: { type: String, required: true, trim: true, unique: true },
    displayName: { type: String, trim: true },
    description: String,
    aliases: [{ type: String, trim: true }],
    keywords: [{ type: String, trim: true }],
    foodExamples: [{ type: String, trim: true }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: objectId, ref: 'User' }
  },
  timestamps
);

export const FoodCategory = existingModel('FoodCategory', foodCategorySchema, 'food_categories');
