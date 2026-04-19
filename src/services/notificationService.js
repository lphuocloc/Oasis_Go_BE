const { Expo } = require("expo-server-sdk");
const expo = new Expo();
const User = require("../models/User");
const Notification = require("../models/Notification");
const { sendPushNotification } = require("../config/firebase");

const EXPO_NOTIFICATION_CHANNEL_ID = String(
  process.env.EXPO_NOTIFICATION_CHANNEL_ID || "default",
).trim();

class NotificationService {
  _normalizeNotificationPayload(payload = {}) {
    const title = String(payload.title || "").trim();
    const message = String(payload.message || payload.body || "").trim();
    const type = String(payload.type || "SYSTEM").toUpperCase();
    const event_code = String(
      payload.event_code || "SYSTEM_GENERAL",
    ).toUpperCase();
    const data =
      payload.data && typeof payload.data === "object" ? payload.data : {};

    return {
      title,
      message,
      type,
      event_code,
      data,
      dedupe_key: payload.dedupe_key ? String(payload.dedupe_key) : null,
    };
  }

  _sanitizePushData(data = {}) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[String(key)] = value == null ? "" : String(value);
    }
    return sanitized;
  }

  async sendPush(targetToken, title, body, data = {}) {
    const normalizedToken = String(targetToken || "").trim();
    if (!normalizedToken) {
      console.error("Push token is empty");
      return null;
    }

    const sanitizedData = this._sanitizePushData(data);

    if (!Expo.isExpoPushToken(normalizedToken)) {
      const fcmResult = await sendPushNotification(normalizedToken, {
        title,
        body,
        data: sanitizedData,
      });

      if (!fcmResult?.success) {
        console.error("FCM Service Error:", fcmResult?.error || "Unknown error");
        return null;
      }

      return [
        {
          status: "ok",
          id: fcmResult.response,
          provider: "fcm",
        },
      ];
    }

    const messages = [
      {
        to: normalizedToken,
        sound: "default",
        title,
        body,
        data: sanitizedData,
        channelId: EXPO_NOTIFICATION_CHANNEL_ID,
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

  async createNotification(userId, payload = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      const error = new Error("userId is required");
      error.statusCode = 400;
      throw error;
    }

    const normalizedPayload = this._normalizeNotificationPayload(payload);
    if (!normalizedPayload.title || !normalizedPayload.message) {
      const error = new Error("title and message/body are required");
      error.statusCode = 400;
      throw error;
    }

    try {
      const notification = await Notification.create({
        user_id: normalizedUserId,
        title: normalizedPayload.title,
        message: normalizedPayload.message,
        type: normalizedPayload.type,
        event_code: normalizedPayload.event_code,
        data: normalizedPayload.data,
        dedupe_key: normalizedPayload.dedupe_key,
        is_read: false,
        delivery_status: "PENDING",
      });
      return notification;
    } catch (error) {
      if (error.code === 11000 && normalizedPayload.dedupe_key) {
        return Notification.findOne({
          user_id: normalizedUserId,
          dedupe_key: normalizedPayload.dedupe_key,
        });
      }
      throw error;
    }
  }

  async deliverNotification(notification) {
    if (!notification) {
      return { success: false, error: "Notification not found" };
    }

    const user = await User.findById(notification.user_id).select("fcmToken");
    if (!user || !user.fcmToken) {
      notification.delivery_status = "SKIPPED_NO_TOKEN";
      notification.failure_reason = "User or token not found";
      await notification.save();
      return { success: false, error: "User hoặc Token không tồn tại" };
    }

    try {
      const result = await this.sendPush(
        user.fcmToken,
        notification.title,
        notification.message,
        {
          ...notification.data,
          notification_id: notification.id,
          event_code: notification.event_code,
          type: notification.type,
        },
      );

      if (!result) {
        notification.delivery_status = "FAILED";
        notification.failure_reason = "Invalid push token";
        await notification.save();
        return { success: false, error: "Invalid push token" };
      }

      notification.delivery_status = "SENT";
      notification.failure_reason = null;
      notification.sent_at = new Date();
      await notification.save();
      return { success: true, result };
    } catch (error) {
      notification.delivery_status = "FAILED";
      notification.failure_reason = error.message;
      await notification.save();
      return { success: false, error: error.message };
    }
  }

  async notifyUser(userId, payload = {}) {
    try {
      const notification = await this.createNotification(userId, payload);
      const deliveryResult = await this.deliverNotification(notification);

      try {
        const socketServer = require("../socket/socketServer");
        if (socketServer && typeof socketServer.emitUserNotificationEvent === 'function') {
          socketServer.emitUserNotificationEvent({
            user_id: String(userId),
            notification: typeof notification.toObject === 'function' ? notification.toObject() : notification
          });
        }
      } catch (err) {
        console.error("Socket emitUserNotificationEvent Error:", err);
      }

      return {
        success: deliveryResult.success,
        notification,
        result: deliveryResult.result || null,
        error: deliveryResult.error || null,
      };
    } catch (error) {
      console.error("notifyUser Error:", error);
      return { success: false, error: error.message };
    }
  }

  async sendToUser(userId, payload = {}) {
    // Backward-compatible wrapper
    return this.notifyUser(userId, payload);
  }

  async getUserNotifications(userId, filters = {}) {
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = { user_id: String(userId) };
    if (filters.is_read !== undefined && filters.is_read !== "") {
      query.is_read = String(filters.is_read) === "true";
    }
    if (filters.type) {
      query.type = String(filters.type).toUpperCase();
    }
    if (filters.event_code) {
      query.event_code = String(filters.event_code).toUpperCase();
    }

    const [data, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId) {
    return Notification.countDocuments({
      user_id: String(userId),
      is_read: false,
    });
  }

  async markAsRead(userId, notificationId) {
    const notification = await Notification.findOne({
      id: String(notificationId),
      user_id: String(userId),
    });

    if (!notification) {
      const error = new Error("Notification not found");
      error.statusCode = 404;
      throw error;
    }

    if (!notification.is_read) {
      notification.is_read = true;
      notification.read_at = new Date();
      await notification.save();
    }

    return notification;
  }

  async markAllAsRead(userId) {
    try {
      const updated = await Notification.updateMany(
        { user_id: String(userId), is_read: false },
        { $set: { is_read: true, read_at: new Date() } },
      );

      return {
        matched_count: updated.matchedCount || 0,
        modified_count: updated.modifiedCount || 0,
      };
    } catch (error) {
      console.error("markAllAsRead Error:", error);
      throw error;
    }
  }
}

module.exports = new NotificationService();
