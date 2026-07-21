import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { getPaymentHistory, processRevenueCatWebhook, verifyRevenueCatAuthorization } from '../services/paymentService';

function handlePaymentError(res: Response, error: any) {
  const message = error?.message ?? 'Server error';
  res.status(message.includes('authorization') ? 401 : message.includes('Invalid') || message.includes('Unknown') ? 400 : 500).json({ success: false, message });
}

export const revenueCatWebhookHandler = async (req: Request, res: Response) => {
  try {
    verifyRevenueCatAuthorization(req.headers.authorization);
    await processRevenueCatWebhook(req.body);
    res.status(200).json({ success: true });
  } catch (error) { handlePaymentError(res, error); }
};

export const getPaymentHistoryHandler = async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: await getPaymentHistory(req.user!.userId) });
  } catch (error) { handlePaymentError(res, error); }
};
