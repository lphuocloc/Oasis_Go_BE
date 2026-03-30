const express = require("express");
const staffAttendanceLogController = require("../controllers/staffAttendanceLogController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/staff-attendance-logs/me:
 *   get:
 *     summary: Get my attendance logs
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page (default 20, max 100)
 */
router.get(
  "/me",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner"),
  staffAttendanceLogController.getMyAttendanceLogs
);

/**
 * @swagger
 * /api/staff-attendance-logs/checkin:
 *   post:
 *     summary: Check in for a shift assignment
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/checkin",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner"),
  staffAttendanceLogController.checkinWork
);

/**
 * @swagger
 * /api/staff-attendance-logs/checkout:
 *   post:
 *     summary: Check out for a shift assignment
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/checkout",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner"),
  staffAttendanceLogController.checkoutWork
);

/**
 * @swagger
 * /api/staff-attendance-logs:
 *   get:
 *     summary: Get attendance logs
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page (default 20, max 100)
 */
router.get(
  "/",
  authMiddleware.protect,
  authMiddleware.authorize("admin", "manager"),
  staffAttendanceLogController.getAttendanceLogs
);

/**
 * @swagger
 * /api/staff-attendance-logs/{id}:
 *   get:
 *     summary: Get attendance log by ID
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/:id",
  authMiddleware.protect,
  authMiddleware.authorize("admin", "manager", "cleaner"),
  staffAttendanceLogController.getAttendanceLogById
);

module.exports = router;
