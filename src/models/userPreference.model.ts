import { Schema } from 'mongoose';

import { existingModel, objectId, timestamps } from './modelHelpers';

const userPreferenceSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, unique: true, index: true },
    dietaryGoal: {
      type: String,
      enum: ['WEIGHT_LOSS', 'MAINTAIN', 'MUSCLE_GAIN', 'HEALTHY_EATING'],
      default: 'HEALTHY_EATING'
    },
    calorieTarget: { type: Number, default: 2000, min: 0 },
    dislikedFoods: [{ type: String }],
    allergies: [{ type: String }],
    preferredCuisines: [{ type: String }],
    numberOfPeople: { type: Number, default: 1, min: 1 }
  },
  timestamps
);

export const UserPreference = existingModel(
  'UserPreference',
  userPreferenceSchema,
  'user_preferences'
);
