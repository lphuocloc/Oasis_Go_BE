const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const User = require("../models/User");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management endpoints
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get list of all active users (cleaners by default)
 *     description: Returns list of active users. Filters by role if provided, otherwise returns cleaners.
 *     tags: [Users]
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: 69bea38c2f15371f651d17d9
 *                       name:
 *                         type: string
 *                         example: John Cleaner
 *                       email:
 *                         type: string
 *                         example: cleaner@example.com
 *                       phone:
 *                         type: string
 *                         example: "0912345678"
 *                       avatar:
 *                         type: string
 *                         nullable: true
 *                       role:
 *                         type: string
 *                         example: cleaner
 *                       isActive:
 *                         type: boolean
 *                         example: true
 *       401:
 *         description: Unauthorized - Missing or invalid token
 *       500:
 *         description: Server error
 */
router.get("/", protect, async (req, res) => {
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
    console.error("Get users error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

module.exports = router;
