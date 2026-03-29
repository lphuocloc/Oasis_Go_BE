const notificationService = require("../services/notificationService");

class NotificationController {
  async getMyNotifications(req, res, next) {
    try {
      const userId = String(req.user?._id || req.user?.id || "");
      const { page = 1, limit = 20, is_read, type, event_code } = req.query;

      const result = await notificationService.getUserNotifications(userId, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        is_read,
        type,
        event_code,
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req, res, next) {
    try {
      const userId = String(req.user?._id || req.user?.id || "");
      const count = await notificationService.getUnreadCount(userId);

      return res.status(200).json({
        success: true,
        data: { unread_count: count },
      });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const userId = String(req.user?._id || req.user?.id || "");
      const { id } = req.params;
      const notification = await notificationService.markAsRead(userId, id);

      return res.status(200).json({
        success: true,
        message: "Notification marked as read",
        data: notification,
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  async markAllAsRead(req, res, next) {
    try {
      const userId = String(req.user?._id || req.user?.id || "");
      const result = await notificationService.markAllAsRead(userId);

      return res.status(200).json({
        success: true,
        message: "All notifications marked as read",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
