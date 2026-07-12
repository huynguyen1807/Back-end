import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import {
  createSandboxPayment,
  getPaymentHistory,
  markSandboxPaymentSuccess
} from '../services/paymentService';

function getStatusCode(message: string) {
  if (message.includes('must be')) {
    return 400;
  }

  if (message.includes('not found')) {
    return 404;
  }

  return 500;
}

function handlePaymentError(res: Response, error: any) {
  const message = error.message ?? 'Server error';
  res.status(getStatusCode(message)).json({ success: false, message });
}

export const createPaymentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await createSandboxPayment(req.user!.userId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    handlePaymentError(res, error);
  }
};

export const sandboxPaymentSuccessHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await markSandboxPaymentSuccess(
      req.user!.userId,
      req.params.transactionCode as string
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    handlePaymentError(res, error);
  }
};

export const getPaymentHistoryHandler = async (req: AuthRequest, res: Response) => {
  try {
    const history = await getPaymentHistory(req.user!.userId);
    res.json({ success: true, data: history });
  } catch (error: any) {
    handlePaymentError(res, error);
  }
};
