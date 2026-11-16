import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  getNotifications,
  markAllAsRead,
  markAsRead,
  deleteNotification,
  deleteAllNotifications,
  deleteReadNotifications,
} from '../controllers/notificationController';

const notificationRouter = Router();

notificationRouter.use(protect);

notificationRouter.get('/', getNotifications);

// QUAN TRỌNG: /read-all phải đặt TRƯỚC /:id/read để tránh Express match nhầm
notificationRouter.patch('/read-all', markAllAsRead);
notificationRouter.patch('/:id/read', markAsRead);

notificationRouter.delete('/', deleteAllNotifications);
// QUAN TRỌNG: /read phải đặt TRƯỚC /:id để tránh Express hiểu "read" là 1 id
notificationRouter.delete('/read', deleteReadNotifications);
notificationRouter.delete('/:id', deleteNotification);

export default notificationRouter;
