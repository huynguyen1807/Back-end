import { User } from '../models/user.model';
import { UserPreference } from '../models/userPreference.model';

export const updateUserProfile = async (userId: string, updateData: any) => {
  const { fullName, phoneNumber, avatarUrl } = updateData;

  const user = await User.findByIdAndUpdate(
    userId,
    { fullName, phoneNumber, avatarUrl },
    { returnDocument: 'after', runValidators: true }
  ).select('-passwordHash');

  if (!user) {
    throw new Error('User not found');
  }

  return user;
};

export const updateUserPreferences = async (userId: string, preferencesData: any) => {
  const updateData: any = {};

  if (preferencesData.dietaryGoal !== undefined) {
    updateData.dietaryGoal = preferencesData.dietaryGoal;
  } else if (preferencesData.dietaryGoals !== undefined) {
    updateData.dietaryGoal = preferencesData.dietaryGoals;
  }

  if (preferencesData.calorieTarget !== undefined) {
    updateData.calorieTarget = Number(preferencesData.calorieTarget);
  }

  if (preferencesData.dislikedFoods !== undefined) {
    updateData.dislikedFoods = preferencesData.dislikedFoods;
  } else if (preferencesData.dislikedIngredients !== undefined) {
    updateData.dislikedFoods = preferencesData.dislikedIngredients;
  }

  if (preferencesData.allergies !== undefined) {
    updateData.allergies = preferencesData.allergies;
  }

  if (preferencesData.preferredCuisines !== undefined) {
    updateData.preferredCuisines = preferencesData.preferredCuisines;
  }

  if (preferencesData.numberOfPeople !== undefined) {
    updateData.numberOfPeople = Number(preferencesData.numberOfPeople);
  }

  if (preferencesData.defaultMealTypes !== undefined) {
    updateData.defaultMealTypes = preferencesData.defaultMealTypes;
  }

  // Find and update, or create if not exists (upsert)
  const preferences = await UserPreference.findOneAndUpdate(
    { userId },
    updateData,
    { returnDocument: 'after', upsert: true, runValidators: true }
  );

  return preferences;
};
