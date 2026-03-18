const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createLocationWarehouse,
  getAllLocationWarehouses,
  getLocationWarehouseById,
  getEffectiveLocationWarehouses,
  getEffectiveLocationWarehousesDebug,
  updateLocationWarehouse,
  deleteLocationWarehouse,
} = require("../controllers/locationWarehouseController");

/**
 * @swagger
 * tags:
 *   name: Location Warehouses
 *   description: Map locations to warehouses and resolve effective warehouse chain
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LocationWarehouse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 6165d003-2f8c-4f2c-a29a-55a94f702f59
 *         location_id:
 *           type: string
 *           example: loc_001
 *         warehouse_id:
 *           type: string
 *           example: wh_001
 *         created_at:
 *           type: string
 *           format: date-time
 *     LocationWarehouseInput:
 *       type: object
 *       required:
 *         - location_id
 *         - warehouse_id
 *       properties:
 *         location_id:
 *           type: string
 *           example: loc_001
 *         warehouse_id:
 *           type: string
 *           example: wh_001
 */

/**
 * @swagger
 * /api/location-warehouses:
 *   get:
 *     summary: Get all location warehouse mappings
 *     tags: [Location Warehouses]
 *     responses:
 *       200:
 *         description: Location warehouse mappings retrieved successfully
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
 *                     $ref: '#/components/schemas/LocationWarehouse'
 */
router.get("/", getAllLocationWarehouses);

/**
 * @swagger
 * /api/location-warehouses/effective/{locationId}:
 *   get:
 *     summary: Get effective warehouse mappings for a location
 *     description: Resolve effective warehouse mappings from current location and its parents
 *     tags: [Location Warehouses]
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Effective location warehouse mappings retrieved successfully
 */
router.get("/effective/:locationId", getEffectiveLocationWarehouses);

/**
 * @swagger
 * /api/location-warehouses/effective/{locationId}/debug:
 *   get:
 *     summary: Debug effective warehouse resolution
 *     tags: [Location Warehouses]
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Effective warehouse debug info retrieved successfully
 */
router.get("/effective/:locationId/debug", getEffectiveLocationWarehousesDebug);

/**
 * @swagger
 * /api/location-warehouses/{id}:
 *   get:
 *     summary: Get location warehouse mapping by ID
 *     tags: [Location Warehouses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mapping retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/LocationWarehouse'
 *       404:
 *         description: Mapping not found
 */
router.get("/:id", getLocationWarehouseById);

/**
 * @swagger
 * /api/location-warehouses:
 *   post:
 *     summary: Create location warehouse mapping
 *     tags: [Location Warehouses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LocationWarehouseInput'
 *     responses:
 *       201:
 *         description: Mapping created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", protect, authorize("admin", "manager"), createLocationWarehouse);

/**
 * @swagger
 * /api/location-warehouses/{id}:
 *   put:
 *     summary: Update location warehouse mapping
 *     tags: [Location Warehouses]
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
 *             $ref: '#/components/schemas/LocationWarehouseInput'
 *     responses:
 *       200:
 *         description: Mapping updated successfully
 *       404:
 *         description: Mapping not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.put("/:id", protect, authorize("admin", "manager"), updateLocationWarehouse);

/**
 * @swagger
 * /api/location-warehouses/{id}:
 *   delete:
 *     summary: Delete location warehouse mapping
 *     tags: [Location Warehouses]
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
 *         description: Mapping deleted successfully
 *       404:
 *         description: Mapping not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.delete("/:id", protect, authorize("admin"), deleteLocationWarehouse);

module.exports = router;
