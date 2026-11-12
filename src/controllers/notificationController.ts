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

    // Trả về tất cả notifications chưa bị xoá của user, mới nhất trước
    const list = await Notification.find({ userId, isDeleted: false }).sort({ createdAt: -1 });
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
      { userId, isRead: false, isDeleted: false },
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
      { _id: id, userId, isDeleted: false },
      { isRead: true, readAt: new Date() },
      { returnDocument: 'after' }
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
 * Soft-delete a single notification (giữ lại document để tránh
 * checkExpiryAndNotify/checkStorageAndNotify tạo lại cùng cảnh báo).
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId, isDeleted: false },
      { isDeleted: true },
      { returnDocument: 'after' }
    );

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
 * Soft-delete all notifications for current user
 */
export const deleteAllNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const result = await Notification.updateMany({ userId, isDeleted: false }, { isDeleted: true });
    res.json({ success: true, deleted: result.modifiedCount });
  } catch (error: any) {
    console.error('[deleteAllNotifications error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/notifications/read
 * Soft-delete only the notifications the user has already read
 */
export const deleteReadNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const result = await Notification.updateMany(
      { userId, isRead: true, isDeleted: false },
      { isDeleted: true }
    );
    res.json({ success: true, deleted: result.modifiedCount });
  } catch (error: any) {
    console.error('[deleteReadNotifications error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
