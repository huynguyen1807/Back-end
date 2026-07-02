import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  getNotifications,
  markAllAsRead,
  markAsRead,
  deleteNotification,
  deleteAllNotifications,
} from '../controllers/notificationController';

const notificationRouter = Router();

notificationRouter.use(protect);

notificationRouter.get('/', getNotifications);

// QUAN TRỌNG: /read-all phải đặt TRƯỚC /:id/read để tránh Express match nhầm
notificationRouter.patch('/read-all', markAllAsRead);
notificationRouter.patch('/:id/read', markAsRead);

notificationRouter.delete('/', deleteAllNotifications);
notificationRouter.delete('/:id', deleteNotification);

export default notificationRouter;
