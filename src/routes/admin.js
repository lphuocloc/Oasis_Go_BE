const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const dashboardController = require("../controllers/DashboardController");

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

module.exports = router;
