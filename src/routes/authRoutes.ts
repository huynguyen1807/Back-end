import { Router } from 'express';
import { register, login, getMe, verifyOTP, resendOTP, googleLogin } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', register);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', login);
router.post('/google', googleLogin);
router.get('/me', protect, getMe);

export default router;
