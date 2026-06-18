import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const notificationSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    householdId: { type: objectId, ref: 'Household' },
    foodItemId: { type: objectId, ref: 'FoodItem' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['EXPIRY_ALERT', 'STORAGE_WARNING', 'MEAL_REMINDER', 'FAMILY_SYNC', 'PAYMENT_RESULT'],
      required: true
    },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    isRead: { type: Boolean, default: false },
    scheduledAt: Date,
    sentAt: Date,
    readAt: Date
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ scheduledAt: 1 });

export const Notification = existingModel('Notification', notificationSchema, 'notifications');
