import { Router } from 'express';
import { getSubscriptionPlans, getCurrentSubscription } from '../controllers/subscriptionController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.get('/plans', getSubscriptionPlans);
router.get('/current', protect, getCurrentSubscription);

export default router;
