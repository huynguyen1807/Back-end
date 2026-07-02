/**
 * Gửi push notification qua Expo Push API.
 * Không cần API key — chỉ cần expoPushToken của device.
 */
export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  // Bỏ qua nếu token không hợp lệ
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) {
    return;
  }

  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data: data ?? {},
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[sendPushNotification] Expo API error:', err);
    }
  } catch (error) {
    // Lỗi mạng không được làm crash server
    console.error('[sendPushNotification] Network error:', error);
  }
}
