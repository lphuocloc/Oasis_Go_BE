const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryStock,
  getAllInventoryStocks,
  getInventoryStockById,
  updateInventoryStock,
  deleteInventoryStock,
} = require("../controllers/inventoryStockController");

/**
 * @swagger
 * tags:
 *   name: Inventory Stocks
 *   description: Manage inventory stock levels by warehouse and item
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     InventoryStock:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 9f1e7a9e-1da6-4988-8d76-f2df95fbe2a7
 *         warehouse_id:
 *           type: string
 *           example: wh_001
 *         item_id:
 *           type: string
 *           example: item_001
 *         quantity_available:
 *           type: number
 *           example: 120
 *         updated_at:
 *           type: string
 *           format: date-time
 *     InventoryStockInput:
 *       type: object
 *       required:
 *         - warehouse_id
 *         - item_id
 *         - quantity_available
 *       properties:
 *         warehouse_id:
 *           type: string
 *           example: wh_001
 *         item_id:
 *           type: string
 *           example: item_001
 *         quantity_available:
 *           type: number
 *           minimum: 0
 *           example: 50
 */

/**
 * @swagger
 * /api/inventory-stocks:
 *   get:
 *     summary: Get all inventory stocks
 *     tags: [Inventory Stocks]
 *     parameters:
 *       - in: query
 *         name: warehouse_id
 *         schema:
 *           type: string
 *         description: Filter by warehouse ID
 *       - in: query
 *         name: item_id
 *         schema:
 *           type: string
 *         description: Filter by item ID
 *     responses:
 *       200:
 *         description: Inventory stocks retrieved successfully
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
 *                     $ref: '#/components/schemas/InventoryStock'
 */
router.get("/", getAllInventoryStocks);

/**
 * @swagger
 * /api/inventory-stocks/{id}:
 *   get:
 *     summary: Get inventory stock by ID
 *     tags: [Inventory Stocks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory stock retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/InventoryStock'
 *       404:
 *         description: Inventory stock not found
 */
router.get("/:id", getInventoryStockById);

/**
 * @swagger
 * /api/inventory-stocks:
 *   post:
 *     summary: Create inventory stock
 *     tags: [Inventory Stocks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryStockInput'
 *     responses:
 *       201:
 *         description: Inventory stock created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", protect, authorize("admin", "manager"), createInventoryStock);

/**
 * @swagger
 * /api/inventory-stocks/{id}:
 *   put:
 *     summary: Update inventory stock
 *     tags: [Inventory Stocks]
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
 *             $ref: '#/components/schemas/InventoryStockInput'
 *     responses:
 *       200:
 *         description: Inventory stock updated successfully
 *       404:
 *         description: Inventory stock not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.put("/:id", protect, authorize("admin", "manager"), updateInventoryStock);

/**
 * @swagger
 * /api/inventory-stocks/{id}:
 *   delete:
 *     summary: Delete inventory stock
 *     tags: [Inventory Stocks]
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
 *         description: Inventory stock deleted successfully
 *       404:
 *         description: Inventory stock not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.delete("/:id", protect, authorize("admin"), deleteInventoryStock);

module.exports = router;
