const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryCheckoutLog,
  getAllInventoryCheckoutLogs,
  getInventoryCheckoutLogById,
  updateInventoryCheckoutLog,
  deleteInventoryCheckoutLog,
} = require("../controllers/inventoryCheckoutLogController");

/**
 * @swagger
 * tags:
 *   name: Inventory Checkout Logs
 *   description: Track inventory item checkout, return, and waste actions
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     InventoryCheckoutLog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 7c13d656-c8c6-4c0c-8b63-c1f6a6ca03c9
 *         inventory_stock_id:
 *           type: string
 *           example: stock_001
 *         staff_id:
 *           type: string
 *           example: user_001
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *           example: task_clean_001
 *         maintenance_task_id:
 *           type: string
 *           nullable: true
 *           example: task_maint_001
 *         quantity:
 *           type: number
 *           minimum: 1
 *           example: 2
 *         action_type:
 *           type: string
 *           enum: [CHECKOUT, RETURN, WASTE, INITIAL, ADJUSTMENT]
 *           example: CHECKOUT
 *         reason:
 *           type: string
 *           nullable: true
 *           example: Use for routine cleaning
 *         actor_id:
 *           type: string
 *           nullable: true
 *           description: Stored automatically from the authenticated actor
 *         created_at:
 *           type: string
 *           format: date-time
 *     InventoryCheckoutLogInput:
 *       type: object
 *       required:
 *         - inventory_stock_id
 *         - quantity
 *         - action_type
 *       properties:
 *         inventory_stock_id:
 *           type: string
 *           example: stock_001
 *         staff_id:
 *           type: string
 *           nullable: true
 *           description: Defaults to the authenticated user; managers can override when needed
 *           example: user_001
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *         maintenance_task_id:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: number
 *           minimum: 1
 *           example: 1
 *         action_type:
 *           type: string
 *           enum: [CHECKOUT, RETURN, WASTE, INITIAL, ADJUSTMENT]
 *           example: RETURN
 *         reason:
 *           type: string
 *           nullable: true
 */

/**
 * @swagger
 * /api/inventory-checkout-logs:
 *   get:
 *     summary: Get all inventory checkout logs
 *     tags: [Inventory Checkout Logs]
 *     responses:
 *       200:
 *         description: Inventory checkout logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InventoryCheckoutLog'
 */
router.get("/", getAllInventoryCheckoutLogs);

/**
 * @swagger
 * /api/inventory-checkout-logs/{id}:
 *   get:
 *     summary: Get inventory checkout log by ID
 *     tags: [Inventory Checkout Logs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory checkout log retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/InventoryCheckoutLog'
 *       404:
 *         description: Inventory checkout log not found
 */
router.get("/:id", getInventoryCheckoutLogById);

/**
 * @swagger
 * /api/inventory-checkout-logs:
 *   post:
 *     summary: Create inventory checkout log
 *     tags: [Inventory Checkout Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryCheckoutLogInput'
 *     responses:
 *       201:
 *         description: Inventory checkout log created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", protect, authorize("admin", "manager"), createInventoryCheckoutLog);

/**
 * @swagger
 * /api/inventory-checkout-logs/{id}:
 *   put:
 *     summary: Update inventory checkout log
 *     tags: [Inventory Checkout Logs]
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
 *             $ref: '#/components/schemas/InventoryCheckoutLogInput'
 *     responses:
 *       200:
 *         description: Inventory checkout log updated successfully
 *       404:
 *         description: Inventory checkout log not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.put("/:id", protect, authorize("admin", "manager"), updateInventoryCheckoutLog);

/**
 * @swagger
 * /api/inventory-checkout-logs/{id}:
 *   delete:
 *     summary: Delete inventory checkout log
 *     tags: [Inventory Checkout Logs]
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
 *         description: Inventory checkout log deleted successfully
 *       404:
 *         description: Inventory checkout log not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.delete("/:id", protect, authorize("admin"), deleteInventoryCheckoutLog);

module.exports = router;
