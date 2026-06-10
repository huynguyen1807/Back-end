import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const foodCategorySchema = new Schema(
  {
    categoryName: { type: String, required: true, trim: true, unique: true },
    description: String,
    isActive: { type: Boolean, default: true },
    createdBy: { type: objectId, ref: 'User' }
  },
  timestamps
);

export const FoodCategory = existingModel('FoodCategory', foodCategorySchema, 'food_categories');
