const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const depositPolicyController = require("../controllers/depositPolicyController");

/**
 * @swagger
 * tags:
 *   name: Deposit Policies
 *   description: Manage volume-based deposit pricing tiers
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     DepositPolicy:
 *       type: object
 *       properties:
 *         tier_1_pod_limit:
 *           type: integer
 *           example: 3
 *         tier_2_pod_limit:
 *           type: integer
 *           example: 6
 *         tier_1_price:
 *           type: integer
 *           example: 500000
 *         tier_2_price:
 *           type: integer
 *           example: 400000
 *         tier_3_price:
 *           type: integer
 *           example: 300000
 *         source:
 *           type: string
 *           enum: [DEFAULT, CUSTOM]
 *         updated_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         updated_by:
 *           type: string
 *           nullable: true
 *     UpdateDepositPolicyRequest:
 *       type: object
 *       properties:
 *         tier_1_price:
 *           type: integer
 *           minimum: 0
 *           example: 550000
 *         tier_2_price:
 *           type: integer
 *           minimum: 0
 *           example: 420000
 *         tier_3_price:
 *           type: integer
 *           minimum: 0
 *           example: 320000
 */

/**
 * @swagger
 * /api/deposit-policies/current:
 *   get:
 *     summary: Get current deposit pricing policy
 *     tags: [Deposit Policies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deposit policy retrieved successfully
 */
router.get("/current", protect, depositPolicyController.getCurrentPolicy);

/**
 * @swagger
 * /api/deposit-policies/current:
 *   put:
 *     summary: Update deposit pricing for 3 tiers
 *     description: Update tier prices. Tier prices must be non-increasing (tier_1_price >= tier_2_price >= tier_3_price).
 *     tags: [Deposit Policies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDepositPolicyRequest'
 *     responses:
 *       200:
 *         description: Deposit policy updated successfully
 *       400:
 *         description: Invalid input
 */
router.put("/current", protect, authorize("admin"), depositPolicyController.updateCurrentPolicy);

module.exports = router;
