import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { getPaymentHistory, processRevenueCatWebhook, verifyRevenueCatAuthorization } from '../services/paymentService';
import { createPayOSCheckout, processPayOSWebhook, getPayOSPaymentStatus, PayOSPaymentError } from '../services/paymentService';

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

function handlePayOSFailure(res: Response, error: unknown) {
  if (error instanceof PayOSPaymentError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
  } else {
    res.status(503).json({ success: false, message: 'payOS payment service is unavailable' });
  }
}

export const createPayOSCheckoutHandler = async (req: AuthRequest, res: Response) => {
  try {
    const data = await createPayOSCheckout(req.user!.userId, req.body ?? {});
    res.status(data.status === 'PENDING' ? (data.checkoutUrl ? 201 : 202) : 200).json({ success: true, data });
  } catch (error) { handlePayOSFailure(res, error); }
};

export const payOSWebhookHandler = async (req: Request, res: Response) => {
  try { res.status(200).json({ success: true, ...await processPayOSWebhook(req.body) }); }
  catch (error) { handlePayOSFailure(res, error); }
};

export const getPayOSPaymentStatusHandler = async (req: AuthRequest, res: Response) => {
  try { res.json({ success: true, data: await getPayOSPaymentStatus(req.user!.userId, req.params.orderCode) }); }
  catch (error) { handlePayOSFailure(res, error); }
};
