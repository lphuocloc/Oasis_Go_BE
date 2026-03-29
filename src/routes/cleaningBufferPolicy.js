const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const cleaningBufferPolicyController = require("../controllers/cleaningBufferPolicyController");

/**
 * @swagger
 * tags:
 *   name: Cleaning Buffer Policies
 *   description: Manage cleaning buffer policy configuration
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CleaningBufferPolicy:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         location_id:
 *           type: string
 *           nullable: true
 *         cluster_id:
 *           type: string
 *           nullable: true
 *         pod_id:
 *           type: string
 *           nullable: true
 *         buffer_minutes:
 *           type: integer
 *           minimum: 0
 *         is_active:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *     CleaningBufferPolicyRequest:
 *       type: object
 *       required:
 *         - buffer_minutes
 *       properties:
 *         location_id:
 *           type: string
 *           nullable: true
 *         cluster_id:
 *           type: string
 *           nullable: true
 *         pod_id:
 *           type: string
 *           nullable: true
 *         buffer_minutes:
 *           type: integer
 *           minimum: 0
 *           example: 30
 *         is_active:
 *           type: boolean
 *           example: true
 */

/**
 * @swagger
 * /api/cleaning-buffer-policies:
 *   get:
 *     summary: Get all cleaning buffer policies
 *     tags: [Cleaning Buffer Policies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: cluster_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Cleaning buffer policies retrieved successfully
 */
router.get("/", protect, authorize("admin"), cleaningBufferPolicyController.getAllPolicies);

/**
 * @swagger
 * /api/cleaning-buffer-policies/{id}:
 *   get:
 *     summary: Get cleaning buffer policy by ID
 *     tags: [Cleaning Buffer Policies]
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
 *         description: Cleaning buffer policy retrieved successfully
 *       404:
 *         description: Cleaning buffer policy not found
 */
router.get("/:id", protect, authorize("admin"), cleaningBufferPolicyController.getPolicyById);

/**
 * @swagger
 * /api/cleaning-buffer-policies:
 *   post:
 *     summary: Create cleaning buffer policy
 *     tags: [Cleaning Buffer Policies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CleaningBufferPolicyRequest'
 *     responses:
 *       201:
 *         description: Cleaning buffer policy created successfully
 */
router.post("/", protect, authorize("admin"), cleaningBufferPolicyController.createPolicy);

/**
 * @swagger
 * /api/cleaning-buffer-policies/{id}:
 *   put:
 *     summary: Update cleaning buffer policy
 *     tags: [Cleaning Buffer Policies]
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
 *             $ref: '#/components/schemas/CleaningBufferPolicyRequest'
 *     responses:
 *       200:
 *         description: Cleaning buffer policy updated successfully
 *       404:
 *         description: Cleaning buffer policy not found
 */
router.put("/:id", protect, authorize("admin"), cleaningBufferPolicyController.updatePolicy);

/**
 * @swagger
 * /api/cleaning-buffer-policies/{id}:
 *   delete:
 *     summary: Delete cleaning buffer policy
 *     tags: [Cleaning Buffer Policies]
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
 *         description: Cleaning buffer policy deleted successfully
 *       404:
 *         description: Cleaning buffer policy not found
 */
router.delete("/:id", protect, authorize("admin"), cleaningBufferPolicyController.deletePolicy);

module.exports = router;
