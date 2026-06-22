import { User } from '../models/user.model';
import { UserPreference } from '../models/userPreference.model';

export const updateUserProfile = async (userId: string, updateData: any) => {
  const { fullName, phoneNumber, avatarUrl } = updateData;

  const user = await User.findByIdAndUpdate(
    userId,
    { fullName, phoneNumber, avatarUrl },
    { new: true, runValidators: true }
  ).select('-passwordHash');

  if (!user) {
    throw new Error('User not found');
  }

  return user;
};

export const updateUserPreferences = async (userId: string, preferencesData: any) => {
  const { dietaryGoals, allergies, dislikedIngredients, measurementSystem, language, pushNotifications, emailNotifications } = preferencesData;

  // Find and update, or create if not exists (upsert)
  const preferences = await UserPreference.findOneAndUpdate(
    { userId },
    {
      dietaryGoals,
      allergies,
      dislikedIngredients,
      measurementSystem,
      language,
      pushNotifications,
      emailNotifications
    },
    { new: true, upsert: true, runValidators: true }
  );

  return preferences;
};
