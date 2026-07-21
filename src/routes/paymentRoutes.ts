import { Router } from 'express';
import { getPaymentHistoryHandler, revenueCatWebhookHandler } from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = Router();
router.post('/revenuecat/webhook', revenueCatWebhookHandler);
router.get('/history', protect, getPaymentHistoryHandler);
export default router;
