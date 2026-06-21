import { Router } from 'express';
import { updateProfile, updatePreferences } from '../controllers/userController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// All user routes require authentication
router.use(protect);

router.put('/profile', updateProfile);
router.put('/preferences', updatePreferences);

export default router;
