const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const dashboardController = require("../controllers/DashboardController");
const userController = require("../controllers/userController");
const adminLedgerController = require("../controllers/adminLedgerController");

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin statistics endpoints
 */

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Get admin dashboard statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin dashboard stats
 */
router.get("/stats", protect, authorize("admin"), dashboardController.getAdminStats);

/**
 * @swagger
 * /api/admin/dashboard/revenue-series:
 *   get:
 *     summary: Get net revenue series for admin dashboard
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start datetime (ISO-8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End datetime (ISO-8601)
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [day, week, month, year]
 *         description: Grouping unit for the series
 *     responses:
 *       200:
 *         description: Revenue series data
 */
router.get("/dashboard/revenue-series", protect, authorize("admin"), dashboardController.getRevenueSeries);

/**
 * @swagger
 * /api/admin/dashboard/order-success-rate:
 *   get:
 *     summary: Get order success rate for admin dashboard
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start datetime (ISO-8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End datetime (ISO-8601)
 *     responses:
 *       200:
 *         description: Order success rate metrics
 */
router.get("/dashboard/order-success-rate", protect, authorize("admin"), dashboardController.getOrderSuccessRate);

/**
 * @swagger
 * /api/admin/dashboard/bookings-by-cluster:
 *   get:
 *     summary: Get booking volume and gross revenue by cluster
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start datetime (ISO-8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End datetime (ISO-8601)
 *     responses:
 *       200:
 *         description: Booking statistics grouped by cluster
 */
router.get("/dashboard/bookings-by-cluster", protect, authorize("admin"), dashboardController.getBookingsByCluster);

/**
 * @swagger
 * /api/admin/dashboard/summary-cards:
 *   get:
 *     summary: Get summary KPI cards for admin dashboard
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start datetime (ISO-8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End datetime (ISO-8601)
 *     responses:
 *       200:
 *         description: Summary KPI cards data
 */
router.get("/dashboard/summary-cards", protect, authorize("admin"), dashboardController.getSummaryCards);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get list of all active users (users by default)
 *     description: Returns list of active users. Filters by role if provided, otherwise returns users.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, admin, manager, cleaner]
 *         description: Filter users by role (default returns users)
 *         example: user
 *     responses:
 *       200:
 *         description: List of users retrieved successfully
 */
router.get("/users", protect, authorize("admin", "manager"), userController.getActiveUsers);

/**
 * @swagger
 * /api/admin/users:
 *   post:
 *     summary: Create a new user (staff)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post("/users", protect, authorize("admin"), userController.createUser);

/**
 * @swagger
 * /api/admin/users/{id}:
 *   put:
 *     summary: Update an existing user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.put("/users/:id", protect, authorize("admin"), userController.updateUser);

/**
 * @swagger
 * /api/admin/ledger:
 *   get:
 *     summary: Get admin escrow ledger entries
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin ledger entries fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/ledger", protect, authorize("admin"), adminLedgerController.getLedgerEntries);

/**
 * @swagger
 * /api/admin/ledger/summary:
 *   get:
 *     summary: Get admin escrow ledger summary
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin ledger summary fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/ledger/summary", protect, authorize("admin"), adminLedgerController.getLedgerSummary);

module.exports = router;
