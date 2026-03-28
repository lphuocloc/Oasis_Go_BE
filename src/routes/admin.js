const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const dashboardController = require("../controllers/DashboardController");
const userController = require("../controllers/userController");

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

module.exports = router;
