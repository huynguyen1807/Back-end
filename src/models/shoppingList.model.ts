import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const shoppingListItemSchema = new Schema(
  {
    foodName: { type: String, required: true },
    categoryId: { type: objectId, ref: 'FoodCategory' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    reason: {
      type: String,
      enum: ['MISSING_INGREDIENT', 'USER_ADDED', 'LOW_STOCK'],
      default: 'USER_ADDED'
    },
    isPurchased: { type: Boolean, default: false },
    purchasedAt: Date
  },
  { _id: true }
);

const shoppingListSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    listName: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED'], default: 'ACTIVE' },
    items: [shoppingListItemSchema],
    createdFrom: {
      type: { type: String, enum: ['MEAL_PLAN', 'VIDEO_RECIPE', 'MANUAL'], default: 'MANUAL' },
      refId: { type: objectId }
    }
  },
  timestamps
);

shoppingListSchema.index({ userId: 1, status: 1 });

export const ShoppingList = existingModel('ShoppingList', shoppingListSchema, 'shopping_lists');
