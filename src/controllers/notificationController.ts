import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Notification } from '../models/notification.model';
import { FoodItem } from '../models/foodItem.model';

/**
 * GET /api/notifications
 * Fetch user's notifications after doing a dynamic check on active food items to alert of expiry
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // 1. Fetch user's active, unconsumed food items to verify expiry status
    const foods = await FoodItem.find({
      userId,
      isConsumed: false,
      isDeleted: false
    });

    const now = new Date();
    // Normalize date to ignore time parts
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const threeDaysFromNow = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    for (const food of foods) {
      if (!food.expiryDate) continue;
      const expiry = new Date(food.expiryDate);
      const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
      
      if (expiryDay < today) {
        // Expired
        if (food.status !== 'EXPIRED') {
          food.status = 'EXPIRED';
          await food.save();
        }

        // Create alert notification if not already created
        const exists = await Notification.findOne({
          userId,
          foodItemId: food._id,
          type: 'EXPIRY_ALERT',
          message: { $regex: /đã hết hạn/ }
        });

        if (!exists) {
          await Notification.create({
            userId,
            foodItemId: food._id,
            title: 'Thực phẩm đã hết hạn!',
            message: `Thực phẩm "${food.foodName}" của bạn đã quá hạn sử dụng. Vui lòng dọn dẹp để bảo vệ sức khỏe!`,
            type: 'EXPIRY_ALERT',
            priority: 'HIGH',
            isRead: false
          });
        }
      } else if (expiryDay <= threeDaysFromNow) {
        // Near Expiry (<= 3 days)
        if (food.status !== 'NEAR_EXPIRY') {
          food.status = 'NEAR_EXPIRY';
          await food.save();
        }

        // Create alert notification if not already created
        const exists = await Notification.findOne({
          userId,
          foodItemId: food._id,
          type: 'EXPIRY_ALERT',
          message: { $regex: /sắp hết hạn/ }
        });

        if (!exists) {
          const expiryStr = expiry.toLocaleDateString('vi-VN');
          await Notification.create({
            userId,
            foodItemId: food._id,
            title: 'Thực phẩm sắp hết hạn!',
            message: `Thực phẩm "${food.foodName}" sắp hết hạn sử dụng vào ngày ${expiryStr}. Hãy ưu tiên dùng sớm!`,
            type: 'EXPIRY_ALERT',
            priority: 'MEDIUM',
            isRead: false
          });
        }
      }
    }

    // 2. Fetch and return all notifications for the user sorted by newest first
    const list = await Notification.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (error: any) {
    console.error('[getNotifications error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Mark a notification as read
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
