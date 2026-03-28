const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const dashboardController = require("../controllers/DashboardController");
const User = require("../models/User");

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
 *     summary: Get list of all active users (cleaners by default)
 *     description: Returns list of active users. Filters by role if provided, otherwise returns cleaners.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, admin, manager, cleaner]
 *         description: Filter users by role (default returns cleaners)
 *         example: cleaner
 *     responses:
 *       200:
 *         description: List of users retrieved successfully
 */
router.get("/users", protect, authorize("admin", "manager"), async (req, res) => {
  try {
    const { role } = req.query;

    let query = { isActive: true };
    
    // Filter by role if provided, otherwise return cleaners by default
    if (role) {
      query.role = role;
    } else {
      query.role = "cleaner";
    }

    const users = await User.find(query, {
      _id: 1,
      id: 1,
      name: 1,
      email: 1,
      phone: 1,
      avatar: 1,
      role: 1,
      isActive: 1,
      createdAt: 1,
    }).lean();

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Get admin users error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

module.exports = router;
