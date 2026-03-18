const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deleteWarehouse,
} = require("../controllers/warehouseController");

/**
 * @swagger
 * tags:
 *   name: Warehouses
 *   description: Manage warehouse master data
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Warehouse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: dcbf4ab2-63f6-4b12-bf0e-2e5c846df95f
 *         name:
 *           type: string
 *           example: Main Warehouse
 *         address:
 *           type: string
 *           nullable: true
 *           example: 123 Nguyen Van Linh, District 7, HCMC
 *         created_at:
 *           type: string
 *           format: date-time
 *     WarehouseInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: Secondary Warehouse
 *         address:
 *           type: string
 *           nullable: true
 *           example: 456 Le Loi, District 1, HCMC
 */

/**
 * @swagger
 * /api/warehouses:
 *   get:
 *     summary: Get all warehouses
 *     tags: [Warehouses]
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
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
 *                     $ref: '#/components/schemas/Warehouse'
 */
router.get("/", getAllWarehouses);

/**
 * @swagger
 * /api/warehouses/{id}:
 *   get:
 *     summary: Get warehouse by ID
 *     tags: [Warehouses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Warehouse retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Warehouse'
 *       404:
 *         description: Warehouse not found
 */
router.get("/:id", getWarehouseById);

/**
 * @swagger
 * /api/warehouses:
 *   post:
 *     summary: Create warehouse
 *     tags: [Warehouses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WarehouseInput'
 *     responses:
 *       201:
 *         description: Warehouse created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", protect, authorize("admin", "manager"), createWarehouse);

/**
 * @swagger
 * /api/warehouses/{id}:
 *   put:
 *     summary: Update warehouse
 *     tags: [Warehouses]
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
 *             $ref: '#/components/schemas/WarehouseInput'
 *     responses:
 *       200:
 *         description: Warehouse updated successfully
 *       404:
 *         description: Warehouse not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.put("/:id", protect, authorize("admin", "manager"), updateWarehouse);

/**
 * @swagger
 * /api/warehouses/{id}:
 *   delete:
 *     summary: Delete warehouse
 *     tags: [Warehouses]
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
 *         description: Warehouse deleted successfully
 *       404:
 *         description: Warehouse not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.delete("/:id", protect, authorize("admin"), deleteWarehouse);

module.exports = router;
