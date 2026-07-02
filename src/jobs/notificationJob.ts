import { User } from '../models/user.model';
import { runChecksForUser } from '../services/notificationService';

const INTERVAL_HOURS = 6; // Kiểm tra mỗi 6 tiếng
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

async function runNotificationJob(): Promise<void> {
  console.log('[NotificationJob] Bắt đầu kiểm tra thực phẩm cho tất cả users...');
  try {
    const users = await User.find({ status: 'ACTIVE' }).select('_id').lean();
    console.log(`[NotificationJob] Tìm thấy ${users.length} user đang hoạt động.`);

    let totalProcessed = 0;
    for (const user of users) {
      try {
        await runChecksForUser(String(user._id));
        totalProcessed++;
      } catch (err) {
        // Lỗi 1 user không dừng toàn bộ job
        console.error(`[NotificationJob] Lỗi xử lý user ${user._id}:`, err);
      }
    }

    console.log(`[NotificationJob] Hoàn thành. Đã xử lý ${totalProcessed}/${users.length} users.`);
  } catch (err) {
    console.error('[NotificationJob] Lỗi nghiêm trọng:', err);
  }
}

export function startNotificationJob(): void {
  console.log(`[NotificationJob] Khởi động — chạy mỗi ${INTERVAL_HOURS} tiếng.`);

  // Chạy lần đầu ngay sau khi server khởi động (delay 10s để DB ổn định)
  setTimeout(() => {
    void runNotificationJob();
  }, 10_000);

  // Sau đó chạy định kỳ
  setInterval(() => {
    void runNotificationJob();
  }, INTERVAL_MS);
}
