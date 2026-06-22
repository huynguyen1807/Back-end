import { Response } from 'express';
import { updateUserProfile, updateUserPreferences } from '../services/userService';
import { AuthRequest } from '../middleware/authMiddleware';

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
