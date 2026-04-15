const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryCheckoutLog,
  createInventoryCheckoutLogsBulk,
  getShiftInventoryEstimation,
  getCleanerDailyCheckoutLogs,
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
 *     InventoryCheckoutLogBulkInput:
 *       type: object
 *       required:
 *         - logs
 *       properties:
 *         staff_id:
 *           type: string
 *           nullable: true
 *           description: Defaults to authenticated user if omitted
 *         logs:
 *           type: array
 *           minItems: 1
 *           maxItems: 100
 *           items:
 *             type: object
 *             required:
 *               - inventory_stock_id
 *               - quantity
 *             properties:
 *               inventory_stock_id:
 *                 type: string
 *               cleaning_task_id:
 *                 type: string
 *                 nullable: true
 *               maintenance_task_id:
 *                 type: string
 *                 nullable: true
 *               shift_assignment_id:
 *                 type: string
 *                 nullable: true
 *                 description: Used for ownership/permission guard only, not persisted
 *               action_type:
 *                 type: string
 *                 enum: [CHECKOUT, RETURN, WASTE, INITIAL, ADJUSTMENT]
 *                 default: CHECKOUT
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *               reason:
 *                 type: string
 *                 nullable: true
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
 *         shift_assignment_id:
 *           type: string
 *           nullable: true
 *           description: Used for ownership/permission guard only, not persisted to inventory_checkout_logs
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
 *     InventoryEstimationItem:
 *       type: object
 *       properties:
 *         item_id:
 *           type: string
 *         item_name:
 *           type: string
 *           nullable: true
 *         required_quantity:
 *           type: number
 *         available_quantity:
 *           type: number
 *         shortage_quantity:
 *           type: number
 *         suggested_stocks:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               inventory_stock_id:
 *                 type: string
 *               warehouse_id:
 *                 type: string
 *                 nullable: true
 *               warehouse_name:
 *                 type: string
 *                 nullable: true
 *               quantity_available:
 *                 type: number
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
 */
router.post("/", protect, authorize("admin", "manager", "cleaner"), createInventoryCheckoutLog);

/**
 * @swagger
 * /api/inventory-checkout-logs/bulk:
 *   post:
 *     summary: Create multiple inventory checkout logs in one request
 *     tags: [Inventory Checkout Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryCheckoutLogBulkInput'
 *     responses:
 *       201:
 *         description: Inventory checkout logs created successfully
 */
router.post("/bulk", protect, authorize("admin", "manager", "cleaner"), createInventoryCheckoutLogsBulk);

/**
 * @swagger
 * /api/inventory-checkout-logs/estimate/{cleaner_id}:
 *   get:
 *     summary: Estimate required inventory for a cleaner in a day (default today)
 *     tags: [Inventory Checkout Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cleaner_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         description: Date to estimate (ISO date, default is server local today)
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: include_done
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: warehouse_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daily estimation generated successfully
 */
router.get(
  "/estimate/:cleaner_id",
  protect,
  authorize("admin", "manager", "cleaner"),
  getShiftInventoryEstimation
);

/**
 * @swagger
 * /api/inventory-checkout-logs/daily/{cleaner_id}:
 *   get:
 *     summary: Get all CHECKOUT logs for a cleaner on a specific day
 *     tags: [Inventory Checkout Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cleaner_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         description: Date to query (ISO date e.g. 2026-04-15, default today)
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Daily checkout logs retrieved successfully
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Cleaner not found
 */
router.get(
  "/daily/:cleaner_id",
  protect,
  authorize("admin", "manager", "cleaner"),
  getCleanerDailyCheckoutLogs
);

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
 */
router.delete("/:id", protect, authorize("admin"), deleteInventoryCheckoutLog);

module.exports = router;
