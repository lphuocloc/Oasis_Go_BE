const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryActivityLog,
  createInventoryActivityLogsBulk,
  getShiftInventoryEstimation,
  getCleanerDailyActivityLogs,
  getDailyTakenItemsSummary,
  getAllInventoryActivityLogs,
  getInventoryActivityLogById,
  updateInventoryActivityLog,
  deleteInventoryActivityLog,
} = require("../controllers/inventoryActivityLogController");

/**
 * @swagger
 * tags:
 *   name: Inventory Activity Logs
 *   description: Track inventory item checkout, return, consumed, and waste actions
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     InventoryActivityLog:
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
 *           enum: [CHECKOUT, RETURN, CONSUMED, WASTE, INITIAL, ADJUSTMENT]
 *           example: CHECKOUT
 *         reason:
 *           type: string
 *           nullable: true
 *     InventoryActivityLogBulkInput:
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
 *                 enum: [CHECKOUT, RETURN, CONSUMED, WASTE, INITIAL, ADJUSTMENT]
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
 *     InventoryActivityLogInput:
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
 *           description: Used for ownership/permission guard only, not persisted to inventory_activity_logs
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
 *           enum: [CHECKOUT, RETURN, CONSUMED, WASTE, INITIAL, ADJUSTMENT]
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
 * /api/inventory-activity-logs:
 *   get:
 *     summary: Get all Inventory Activity Logs
 *     tags: [Inventory Activity Logs]
 *     responses:
 *       200:
 *         description: Inventory Activity Logs retrieved successfully
 */
router.get("/", getAllInventoryActivityLogs);

/**
 * @swagger
 * /api/inventory-activity-logs/{id}:
 *   get:
 *     summary: Get inventory activity log by ID
 *     tags: [Inventory Activity Logs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: inventory activity log retrieved successfully
 *       404:
 *         description: inventory activity log not found
 */

/**
 * @swagger
 * /api/inventory-activity-logs:
 *   post:
 *     summary: Create inventory activity log
 *     tags: [Inventory Activity Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryActivityLogInput'
 *     responses:
 *       201:
 *         description: inventory activity log created successfully
 */
router.post("/", protect, authorize("admin", "manager", "cleaner"), createInventoryActivityLog);

/**
 * @swagger
 * /api/inventory-activity-logs/bulk:
 *   post:
 *     summary: Create multiple Inventory Activity Logs in one request
 *     tags: [Inventory Activity Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryActivityLogBulkInput'
 *     responses:
 *       201:
 *         description: Inventory Activity Logs created successfully
 */
router.post("/bulk", protect, authorize("admin", "manager", "cleaner"), createInventoryActivityLogsBulk);

/**
 * @swagger
 * /api/inventory-activity-logs/estimate/{cleaner_id}:
 *   get:
 *     summary: Estimate required inventory for a cleaner in a day (default today)
 *     tags: [Inventory Activity Logs]
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
 *         description: Business date in Vietnam timezone (UTC+7), format YYYY-MM-DD; default is today in UTC+7
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: include_done
 *         description: Include DONE tasks in estimation (default true)
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
 * /api/inventory-activity-logs/daily/{cleaner_id}:
 *   get:
 *     summary: Get all CHECKOUT logs for a cleaner on a specific day
 *     tags: [Inventory Activity Logs]
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
 *         description: Business date in Vietnam timezone (UTC+7), format YYYY-MM-DD; default is today in UTC+7
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
  getCleanerDailyActivityLogs
);

/**
 * @swagger
 * /api/inventory-activity-logs/daily-taken-summary:
 *   get:
 *     summary: Get daily taken-item summary grouped by cleaner and item
 *     tags: [Inventory Activity Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         description: Business date in Vietnam timezone (UTC+7), format YYYY-MM-DD; default is today in UTC+7
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: cleaner_id
 *         description: Optional filter by cleaner_id (admin/manager only)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daily taken-item summary retrieved successfully
 *       403:
 *         description: Forbidden
 */
router.get(
  "/daily-taken-summary",
  protect,
  authorize("admin", "manager", "cleaner"),
  getDailyTakenItemsSummary
);

router.get("/:id", getInventoryActivityLogById);

/**
 * @swagger
 * /api/inventory-activity-logs/{id}:
 *   put:
 *     summary: Update inventory activity log
 *     tags: [Inventory Activity Logs]
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
 *             $ref: '#/components/schemas/InventoryActivityLogInput'
 *     responses:
 *       200:
 *         description: inventory activity log updated successfully
 */
router.put("/:id", protect, authorize("admin", "manager"), updateInventoryActivityLog);

/**
 * @swagger
 * /api/inventory-activity-logs/{id}:
 *   delete:
 *     summary: Delete inventory activity log
 *     tags: [Inventory Activity Logs]
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
 *         description: inventory activity log deleted successfully
 */
router.delete("/:id", protect, authorize("admin"), deleteInventoryActivityLog);

module.exports = router;
