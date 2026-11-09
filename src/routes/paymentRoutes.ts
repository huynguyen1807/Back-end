import { Router } from 'express';
import { getPaymentHistoryHandler, revenueCatWebhookHandler, createPayOSCheckoutHandler, payOSWebhookHandler, getPayOSPaymentStatusHandler } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = Router();
router.post('/revenuecat/webhook', revenueCatWebhookHandler);
router.get('/history', protect, getPaymentHistoryHandler);
router.post('/payos/checkout', protect, createPayOSCheckoutHandler);
router.post('/payos/webhook', payOSWebhookHandler);
router.get('/:orderCode/status', protect, getPayOSPaymentStatusHandler);
export default router;
