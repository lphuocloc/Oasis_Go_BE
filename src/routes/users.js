const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const userController = require("../controllers/userController");

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
 *     summary: Get list of all active users (users by default)
 *     description: Returns list of active users. Filters by role if provided, otherwise returns users.
 *     tags: [Users]
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
router.get("/", protect, userController.getActiveUsers);

module.exports = router;
