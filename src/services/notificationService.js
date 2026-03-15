const { Expo } = require("expo-server-sdk");
const expo = new Expo();
const User = require("../models/User");

class NotificationService {
  async sendPush(targetToken, title, body, data = {}) {
    if (!Expo.isExpoPushToken(targetToken)) {
      console.error("Token không hợp lệ:", targetToken);
      return null;
    }

    const messages = [
      {
        to: targetToken,
        sound: "default",
        title,
        body,
        data,
        channelId: "queanh_test_noti",
        priority: "high",
      },
    ];

    try {
      let chunks = expo.chunkPushNotifications(messages);
      let results = [];
      for (let chunk of chunks) {
        const ticket = await expo.sendPushNotificationsAsync(chunk);
        results.push(...ticket);
      }
      return results;
    } catch (error) {
      console.error(" Expo Service Error:", error);
      throw error;
    }
  }

  async sendToUser(userId, { title, body, data = {} }) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) {
        return { success: false, error: "User hoặc Token không tồn tại" };
      }
      // GỌI HÀM sendPush Ở TRÊN
      const result = await this.sendPush(user.fcmToken, title, body, data);
      return { success: true, result };
    } catch (error) {
      console.error("sendToUser Error:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new NotificationService();
