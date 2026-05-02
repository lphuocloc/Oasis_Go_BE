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
 *     responses:
 *       200:
 *         description: List of your attendance logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get(
  "/me",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner", "manager"),
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
 *     responses:
 *       200:
 *         description: Attendance status for the specified date
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/me/status",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner", "manager"),
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
 *     responses:
 *       200:
 *         description: Today's attendance status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/me/today-status",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner", "manager"),
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
 *     responses:
 *       201:
 *         description: Checked in successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Already checked in or invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/checkin",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner", "manager"),
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
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Optional selected card date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Checked out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Checkout failed (e.g. shift not ended, pending tasks, or missing handover)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/checkout",
  authMiddleware.protect,
  authMiddleware.authorize("cleaner", "manager"),
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
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *         description: Filter by staff ID
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *         description: Filter by location ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Successfully retrieved attendance logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Attendance Log ID
 *     responses:
 *       200:
 *         description: Successfully retrieved attendance log
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.get(
  "/:id",
  authMiddleware.protect,
  authMiddleware.authorize("admin", "manager", "cleaner"),
  staffAttendanceLogController.getAttendanceLogById
);

module.exports = router;
