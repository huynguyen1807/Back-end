import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const shoppingListItemSchema = new Schema(
  {
    itemId: { type: objectId },
    foodName: { type: String, required: true },
    categoryId: { type: objectId, ref: 'FoodCategory' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    reason: {
      type: String,
      enum: ['MISSING_INGREDIENT', 'USER_ADDED', 'LOW_STOCK', 'VIDEO_RECIPE'],
      default: 'USER_ADDED'
    },
    isPurchased: { type: Boolean, default: false },
    purchasedAt: Date,
    addedBy: { type: objectId, ref: 'User' },
    purchasedBy: { type: objectId, ref: 'User' }
  },
  { _id: true }
);

const shoppingListSchema = new Schema(
  {
    ownerType: { type: String, enum: ['USER', 'HOUSEHOLD'], required: true },
    userId: { type: objectId, ref: 'User' },
    householdId: { type: objectId, ref: 'Household' },
    listName: { type: String, required: true },
    visibility: { type: String, enum: ['PERSONAL', 'SHARED'], default: 'PERSONAL' },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'], default: 'ACTIVE' },
    items: [shoppingListItemSchema],
    createdFrom: {
      type: { type: String, enum: ['MEAL_PLAN', 'VIDEO_RECIPE', 'MANUAL'], default: 'MANUAL' },
      refId: { type: objectId }
    },
    sharedWith: [
      {
        _id: false,
        userId: { type: objectId, ref: 'User', required: true },
        permission: { type: String, enum: ['VIEW', 'EDIT'], default: 'VIEW' }
      }
    ]
  },
  timestamps
);

shoppingListSchema.index({ userId: 1, status: 1 });
shoppingListSchema.index({ householdId: 1, status: 1 });

export const ShoppingList = existingModel('ShoppingList', shoppingListSchema, 'shopping_lists');
