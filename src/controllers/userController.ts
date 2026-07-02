import { Response } from 'express';
import { updateUserProfile, updateUserPreferences } from '../services/userService';
import { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models/user.model';

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const updatedUser = await updateUserProfile(req.user.userId, req.body);
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error: any) {
    if (error.message === 'User not found') {
      res.status(404).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
};

export const updatePreferences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const updatedPreferences = await updateUserPreferences(req.user.userId, req.body);
    res.json({
      message: 'Preferences updated successfully',
      preferences: updatedPreferences
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * PATCH /api/users/push-token
 * Lưu hoặc xoá Expo push token của thiết bị
 */
export const updatePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { token } = req.body; // null để xoá token (logout)
    await User.findByIdAndUpdate(userId, { expoPushToken: token ?? null });
    res.json({ success: true, message: 'Push token đã được cập nhật' });
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
