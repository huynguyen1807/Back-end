import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { getNotifications, markAsRead } from '../controllers/notificationController';

const notificationRouter = Router();

// Protect all notification routes with auth
notificationRouter.use(protect);

notificationRouter.get('/', getNotifications);
notificationRouter.patch('/:id/read', markAsRead);

export default notificationRouter;
