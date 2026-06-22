import { Request, Response } from 'express';
import { getAllSubscriptionPlans, getUserCurrentSubscription } from '../services/subscriptionService';
import { AuthRequest } from '../middleware/authMiddleware';

export const getSubscriptionPlans = async (req: Request, res: Response) => {
  try {
    const plans = await getAllSubscriptionPlans();
    res.json(plans);
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getCurrentSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const currentSub = await getUserCurrentSubscription(req.user.userId);
    res.json(currentSub);
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
