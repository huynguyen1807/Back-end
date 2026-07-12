import { Router } from 'express';

import {
  createPaymentHandler,
  getPaymentHistoryHandler,
  sandboxPaymentSuccessHandler
} from '../controllers/paymentController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.use(protect);

router.post('/create', createPaymentHandler);
router.post('/sandbox-success/:transactionCode', sandboxPaymentSuccessHandler);
router.get('/history', getPaymentHistoryHandler);

export default router;
