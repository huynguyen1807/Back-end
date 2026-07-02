import { Router } from 'express';
import { updateProfile, updatePreferences, updatePushToken } from '../controllers/userController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// All user routes require authentication
router.use(protect);

router.put('/profile', updateProfile);
router.put('/preferences', updatePreferences);
router.patch('/push-token', updatePushToken);

export default router;
