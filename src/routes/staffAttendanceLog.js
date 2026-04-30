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
 * /api/staff-attendance-logs/me/status:
 *   get:
 *     summary: Check my check-in/check-out status for a specific shift assignment
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:

 *       - in: query
 *         name: date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Optional work date (YYYY-MM-DD), default is today
 */
router.get(
  "/me/status",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner"),
  staffAttendanceLogController.getMyAssignmentAttendanceStatus
);

/**
 * @swagger
 * /api/staff-attendance-logs/me/today-status:
 *   get:
 *     summary: Check my check-in/check-out status for today
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Optional date (YYYY-MM-DD), default is today
 */
router.get(
  "/me/today-status",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner"),
  staffAttendanceLogController.getMyTodayAttendanceStatus
);

/**
 * @swagger
 * /api/staff-attendance-logs/checkin:
 *   post:
 *     summary: Check in for a shift assignment
 *     tags: [Staff Attendance Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:

 *               date:
 *                 type: string
 *                 format: date
 *                 description: Optional selected card date (YYYY-MM-DD)

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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shift_assignment_id:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Optional selected card date (YYYY-MM-DD)

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
