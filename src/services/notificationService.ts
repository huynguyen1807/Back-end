import { FoodItem } from '../models/foodItem.model';
import { Notification } from '../models/notification.model';
import { StorageRule } from '../models/storageRule.model';
import { sendPushNotification } from '../utils/sendPushNotification';
import { User } from '../models/user.model';

// ─── Kiểm tra hạn dùng & tạo notification ────────────────────────────────────
export async function checkExpiryAndNotify(userId: string): Promise<number> {
  const foods = await FoodItem.find({
    userId,
    isConsumed: false,
    isDeleted: false,
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const threeDaysFromNow = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  let created = 0;

  for (const food of foods) {
    if (!food.expiryDate) continue;
    const expiry = new Date(food.expiryDate);
    const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());

    if (expiryDay < today) {
      // Cập nhật status EXPIRED
      if (food.status !== 'EXPIRED') {
        food.status = 'EXPIRED';
        await food.save();
      }
      // Tạo notification nếu chưa có
      const exists = await Notification.findOne({
        userId,
        foodItemId: food._id,
        type: 'EXPIRY_ALERT',
        message: { $regex: /đã hết hạn/ },
      });
      if (!exists) {
        await Notification.create({
          userId,
          foodItemId: food._id,
          title: 'Thực phẩm đã hết hạn!',
          message: `Thực phẩm "${food.foodName}" của bạn đã quá hạn sử dụng. Vui lòng dọn dẹp để bảo vệ sức khỏe!`,
          type: 'EXPIRY_ALERT',
          priority: 'HIGH',
          isRead: false,
        });
        created++;
      }
    } else if (expiryDay <= threeDaysFromNow) {
      // Cập nhật status NEAR_EXPIRY
      if (food.status !== 'NEAR_EXPIRY' && food.status !== 'NEED_CHECK') {
        food.status = 'NEAR_EXPIRY';
        await food.save();
      }
      const exists = await Notification.findOne({
        userId,
        foodItemId: food._id,
        type: 'EXPIRY_ALERT',
        message: { $regex: /sắp hết hạn/ },
      });
      if (!exists) {
        const expiryStr = expiry.toLocaleDateString('vi-VN');
        await Notification.create({
          userId,
          foodItemId: food._id,
          title: 'Thực phẩm sắp hết hạn!',
          message: `Thực phẩm "${food.foodName}" sắp hết hạn vào ngày ${expiryStr}. Hãy ưu tiên dùng sớm!`,
          type: 'EXPIRY_ALERT',
          priority: 'MEDIUM',
          isRead: false,
        });
        created++;
      }
    }
  }

  return created;
}

// ─── Kiểm tra bảo quản sai & tạo STORAGE_WARNING notification ────────────────
export async function checkStorageAndNotify(userId: string): Promise<number> {
  const foods = await FoodItem.find({
    userId,
    isConsumed: false,
    isDeleted: false,
  })
    .populate<{ categoryId: { _id: any } }>('categoryId', '_id')
    .populate<{ storageLocationId: { storageType: string } }>('storageLocationId', 'storageType');

  let created = 0;

  for (const food of foods) {
    const category = food.categoryId as any;
    const location = food.storageLocationId as any;
    if (!category?._id || !location?.storageType) continue;

    // Tìm storage rule tương ứng với category + storageType hiện tại
    const rule = await StorageRule.findOne({
      categoryId: category._id,
      storageType: location.storageType,
      status: 'OFFICIAL',
    });

    if (!rule) {
      // Không có rule → đánh dấu NEED_CHECK
      if (food.status !== 'NEED_CHECK' && food.status !== 'EXPIRED') {
        await FoodItem.findByIdAndUpdate(food._id, { status: 'NEED_CHECK' });
      }

      const exists = await Notification.findOne({
        userId,
        foodItemId: food._id,
        type: 'STORAGE_WARNING',
        message: { $regex: /chưa có quy tắc bảo quản/ },
      });

      if (!exists) {
        await Notification.create({
          userId,
          foodItemId: food._id,
          title: 'Cần kiểm tra bảo quản!',
          message: `Thực phẩm "${food.foodName}" chưa có quy tắc bảo quản phù hợp. Vui lòng kiểm tra lại vị trí lưu trữ.`,
          type: 'STORAGE_WARNING',
          priority: 'LOW',
          isRead: false,
        });
        created++;
      }
    } else {
      // Có rule → kiểm tra số ngày bảo quản đã vượt qua estimatedDays chưa
      const purchaseDate = new Date(food.purchaseDate);
      const now = new Date();
      const daysSincePurchase = Math.floor(
        (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSincePurchase > rule.estimatedDays) {
        const exists = await Notification.findOne({
          userId,
          foodItemId: food._id,
          type: 'STORAGE_WARNING',
          message: { $regex: /đã vượt quá thời gian bảo quản/ },
        });

        if (!exists) {
          const warningMsg = rule.warningMessage
            ? ` ${rule.warningMessage}`
            : '';
          await Notification.create({
            userId,
            foodItemId: food._id,
            title: 'Cảnh báo bảo quản!',
            message: `Thực phẩm "${food.foodName}" đã vượt quá thời gian bảo quản khuyến nghị (${rule.estimatedDays} ngày) tại ${location.storageType}.${warningMsg}`,
            type: 'STORAGE_WARNING',
            priority: 'MEDIUM',
            isRead: false,
          });
          created++;
        }
      }
    }
  }

  return created;
}

// ─── Chạy full check cho 1 user & push notification nếu có new ────────────────
export async function runChecksForUser(userId: string): Promise<void> {
  const [expiryCount, storageCount] = await Promise.all([
    checkExpiryAndNotify(userId),
    checkStorageAndNotify(userId),
  ]);

  const totalNew = expiryCount + storageCount;
  if (totalNew === 0) return;

  // Gửi push notification nếu user có token
  const user = await User.findById(userId).select('expoPushToken').lean() as any;
  if (user?.expoPushToken) {
    await sendPushNotification(
      user.expoPushToken,
      'FreshFriends',
      `Bạn có ${totalNew} cảnh báo mới về thực phẩm. Mở app để xem chi tiết.`
    );
  }
}
