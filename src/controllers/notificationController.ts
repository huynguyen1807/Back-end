import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Notification } from '../models/notification.model';
import { checkExpiryAndNotify, checkStorageAndNotify } from '../services/notificationService';

/**
 * GET /api/notifications
 * Fetch user's notifications — triggers dynamic expiry + storage check first
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Kiểm tra hạn dùng và bảo quản, tạo notification nếu cần
    await Promise.all([
      checkExpiryAndNotify(userId),
      checkStorageAndNotify(userId),
    ]);

    // Trả về tất cả notifications của user, mới nhất trước
    const list = await Notification.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (error: any) {
    console.error('[getNotifications error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read (phải đặt TRƯỚC /:id/read trong router)
 */
export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const result = await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ success: true, updated: result.modifiedCount });
  } catch (error: any) {
    console.error('[markAllAsRead error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read
 */
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({ success: false, message: 'Không tìm thấy thông báo' });
      return;
    }

    res.json({ success: true, data: notification });
  } catch (error: any) {
    console.error('[markAsRead error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/notifications/:id
 * Delete a single notification
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const notification = await Notification.findOneAndDelete({ _id: id, userId });

    if (!notification) {
      res.status(404).json({ success: false, message: 'Không tìm thấy thông báo' });
      return;
    }

    res.json({ success: true, message: 'Đã xoá thông báo' });
  } catch (error: any) {
    console.error('[deleteNotification error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/notifications
 * Delete all notifications for current user
 */
export const deleteAllNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const result = await Notification.deleteMany({ userId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error: any) {
    console.error('[deleteAllNotifications error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
