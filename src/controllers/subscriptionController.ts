import { Request, Response } from 'express';
import { getAllSubscriptionPlans, getUserCurrentSubscription, getHouseholdSubscription, FamilySubscriptionError, FamilyTrialError, startHouseholdTrial } from '../services/subscriptionService';
import { AuthRequest } from '../middleware/authMiddleware';

export const startHouseholdTrialHandler = async (req: AuthRequest, res: Response) => {
  try {
    const trial = await startHouseholdTrial(req.user!.userId, req.params.id as string);
    res.status(201).json({ success: true, data: trial });
  } catch (error) {
    res.status(error instanceof FamilyTrialError ? error.statusCode : 500).json({ success: false,
      message: error instanceof FamilyTrialError ? error.message : 'Unable to start Family trial' });
  }
};

export const getSubscriptionPlans = async (req: Request, res: Response) => {
  try {
    const scope = req.query.scope ?? 'USER';
    if (scope !== 'USER' && scope !== 'HOUSEHOLD') {
      res.status(400).json({ message: 'scope must be USER or HOUSEHOLD' });
      return;
    }
    const plans = await getAllSubscriptionPlans(scope);
    res.json(plans);
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getHouseholdSubscriptionHandler = async (req: AuthRequest, res: Response) => {
  try {
    const subscription = await getHouseholdSubscription(req.user!.userId, req.params.id as string);
    res.json({ success: true, data: subscription });
  } catch (error: any) {
    res.status(error instanceof FamilySubscriptionError ? 403 : 500).json({ success: false, message: error.message });
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
