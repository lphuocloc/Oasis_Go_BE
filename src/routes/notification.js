const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { protect } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification inbox APIs
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "1f6b0f83-7f4f-4fdf-a4cc-99d4e573e0bc"
 *         user_id:
 *           type: string
 *           example: "67d6a05306f95f790f404f3d"
 *         title:
 *           type: string
 *           example: "Check-in thành công"
 *         message:
 *           type: string
 *           example: "Bạn đã check-in thành công và có thể bắt đầu phiên sử dụng."
 *         type:
 *           type: string
 *           enum: [BOOKING, PAYMENT, PROMOTION, SYSTEM, IDENTITY]
 *         event_code:
 *           type: string
 *           example: "BOOKING_CHECKIN"
 *         is_read:
 *           type: boolean
 *           example: false
 *         read_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         data:
 *           type: object
 *           additionalProperties: true
 *         delivery_status:
 *           type: string
 *           enum: [PENDING, SENT, FAILED, SKIPPED_NO_TOKEN]
 *         sent_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         failure_reason:
 *           type: string
 *           nullable: true
 *         dedupe_key:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/notifications/me:
 *   get:
 *     summary: Get my notifications (paginated)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: is_read
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [BOOKING, PAYMENT, PROMOTION, SYSTEM, IDENTITY]
 *       - in: query
 *         name: event_code
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notifications fetched successfully
 */
router.get("/me", protect, notificationController.getMyNotifications);

/**
 * @swagger
 * /api/notifications/me/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count fetched successfully
 */
router.get("/me/unread-count", protect, notificationController.getUnreadCount);

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark one notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.patch("/:id/read", protect, notificationController.markAsRead);

/**
 * @swagger
 * /api/notifications/me/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.patch("/me/read-all", protect, notificationController.markAllAsRead);

module.exports = router;
