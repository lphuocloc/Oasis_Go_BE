const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createLostFoundItem,
  getLostFoundItems,
  getLostFoundItemById,
  updateLostFoundStatus,
} = require("../controllers/lostFoundController");

/**
 * @swagger
 * tags:
 *   name: Lost Found
 *   description: Found-item workflow independent from incident reporting
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LostFoundItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 9c9f1555-f20f-4e1d-b597-c8f6f421648d
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *           example: 129bc093-80fd-4eb7-9f04-d3e2c2390ef8
 *         pod_id:
 *           type: string
 *           example: 8f1a7c3f-9d42-4418-aa0f-f129eb0e2b8d
 *         booking_id:
 *           type: string
 *           nullable: true
 *           example: 98484f31-7549-42fd-8df8-a692bd3da3a4
 *         found_by_user_id:
 *           type: string
 *           example: 87098f0d-a69a-466f-b9c4-9e44383d5882
 *         item_name:
 *           type: string
 *           example: iPhone 14 Pro
 *         description:
 *           type: string
 *           nullable: true
 *           example: Black color phone found under seat
 *         found_at:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [FOUND, STORED, CLAIMED, DISPOSED]
 *           example: STORED
 *         claimed_by_user_id:
 *           type: string
 *           nullable: true
 *         claimed_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     LostFoundCreateInput:
 *       type: object
 *       required:
 *         - item_name
 *       properties:
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *           description: Use this when item was found during a known cleaning task
 *           example: 129bc093-80fd-4eb7-9f04-d3e2c2390ef8
 *         pod_id:
 *           type: string
 *           nullable: true
 *           description: Use this when no cleaning_task_id is available
 *           example: 8f1a7c3f-9d42-4418-aa0f-f129eb0e2b8d
 *         booking_id:
 *           type: string
 *           nullable: true
 *           example: 98484f31-7549-42fd-8df8-a692bd3da3a4
 *         item_name:
 *           type: string
 *           example: Wallet
 *         description:
 *           type: string
 *           example: Brown leather wallet with card holder
 *         found_at:
 *           type: string
 *           format: date-time
 *
 *     LostFoundStatusUpdateInput:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [FOUND, STORED, CLAIMED, DISPOSED]
 *           example: CLAIMED
 */

/**
 * @swagger
 * /api/lost-found-items:
 *   get:
 *     summary: Get lost & found items with filters
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cleaning_task_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: found_by_user_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [FOUND, STORED, CLAIMED, DISPOSED]
 *     responses:
 *       200:
 *         description: Lost & found items retrieved successfully
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
 *                     $ref: '#/components/schemas/LostFoundItem'
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getLostFoundItems);

/**
 * @swagger
 * /api/lost-found-items:
 *   post:
 *     summary: Create lost & found item (independent flow)
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LostFoundCreateInput'
 *     responses:
 *       201:
 *         description: Lost & found item created successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Cleaning task or pod not found
 */
router.post("/", protect, authorize("admin", "manager", "cleaner"), createLostFoundItem);

/**
 * @swagger
 * /api/lost-found-items/{id}:
 *   get:
 *     summary: Get lost & found detail by id
 *     tags: [Lost Found]
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
 *         description: Lost & found item retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/LostFoundItem'
 *       404:
 *         description: Lost & found item not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getLostFoundItemById);

/**
 * @swagger
 * /api/lost-found-items/{id}/status:
 *   patch:
 *     summary: Update lost & found status
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LostFoundStatusUpdateInput'
 *     responses:
 *       200:
 *         description: Lost & found status updated successfully
 *       404:
 *         description: Lost & found item not found
 */
router.patch("/:id/status", protect, authorize("admin", "manager", "cleaner"), updateLostFoundStatus);

module.exports = router;
