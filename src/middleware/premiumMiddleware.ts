import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { Subscription } from '../models/subscription.model';

export const requirePremium = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const activeSub = await Subscription.findOne({
      userId: req.user.userId,
      status: 'ACTIVE',
      endDate: { $gt: new Date() },
      planCode: { $in: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] }
    });

    if (!activeSub) {
      res.status(403).json({ message: 'This feature requires a Premium subscription.' });
      return;
    }

    next();
  } catch (error: any) {
    res.status(500).json({ message: 'Server error while checking premium status' });
  }
};
