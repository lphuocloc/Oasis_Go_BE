const express = require("express");
const router = express.Router();
const locationController = require("../controllers/locationController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Locations
 *   description: Location management and hierarchy
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Location:
 *       type: object
 *       required:
 *         - name
 *         - type
 *       properties:
 *         name:
 *           type: string
 *           description: Location name
 *           example: Sân bay Tân Sơn Nhất
 *         type:
 *           type: string
 *           enum: [airport, terminal, floor]
 *           description: Type of location
 *           example: airport
 *         lat:
 *           type: number
 *           format: float
 *           description: Latitude coordinate
 *           example: 10.8185
 *         lng:
 *           type: number
 *           format: float
 *           description: Longitude coordinate
 *           example: 106.6588
 *         parent_id:
 *           type: string
 *           nullable: true
 *           description: Parent location ID
 *           example: null
 *         description:
 *           type: string
 *           description: Location description
 *           example: Main international airport in Ho Chi Minh City
 *         isActive:
 *           type: boolean
 *           description: Whether location is active
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/locations:
 *   get:
 *     summary: Get all locations
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [airport, terminal, floor]
 *         description: Filter by location type
 *       - in: query
 *         name: parent_id
 *         schema:
 *           type: string
 *         description: Filter by parent ID (use "null" for root locations)
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of locations
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
 *                     $ref: '#/components/schemas/Location'
 *       500:
 *         description: Server error
 */
router.get("/", locationController.getAllLocations);

/**
 * @swagger
 * /api/locations/tree:
 *   get:
 *     summary: Get location tree hierarchy
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: rootId
 *         schema:
 *           type: string
 *         description: Root location ID (omit for full tree)
 *     responses:
 *       200:
 *         description: Location tree structure
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *       500:
 *         description: Server error
 */
router.get("/tree", locationController.getLocationTree);

/**
 * @swagger
 * /api/locations/{id}:
 *   get:
 *     summary: Get location by ID
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     responses:
 *       200:
 *         description: Location details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Location'
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get("/:id", locationController.getLocationById);

/**
 * @swagger
 * /api/locations/{id}/path:
 *   get:
 *     summary: Get location hierarchy path (from root to location)
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     responses:
 *       200:
 *         description: Location path from root
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Location'
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get("/:id/path", locationController.getLocationPath);

/**
 * @swagger
 * /api/locations/{id}/descendants:
 *   get:
 *     summary: Get all descendants of a location
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     responses:
 *       200:
 *         description: List of descendants
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
 *                     $ref: '#/components/schemas/Location'
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get("/:id/descendants", locationController.getLocationDescendants);

/**
 * @swagger
 * /api/locations:
 *   post:
 *     summary: Create a new location
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Location'
 *           example:
 *             name: Sân bay Tân Sơn Nhất
 *             type: airport
 *             lat: 10.8185
 *             lng: 106.6588
 *             parent_id: null
 *             description: Main international airport in Ho Chi Minh City
 *     responses:
 *       201:
 *         description: Location created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Location'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Parent location not found
 *       409:
 *         description: Location ID already exists
 *       500:
 *         description: Server error
 */
router.post("/", protect, authorize("admin"), locationController.createLocation);

/**
 * @swagger
 * /api/locations/{id}:
 *   put:
 *     summary: Update a location
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [airport, terminal, floor]
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               parent_id:
 *                 type: string
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Location updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.put("/:id", protect, authorize("admin"), locationController.updateLocation);

/**
 * @swagger
 * /api/locations/{id}:
 *   delete:
 *     summary: Delete a location
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     responses:
 *       200:
 *         description: Location deleted successfully
 *       400:
 *         description: Cannot delete location with children or pod clusters
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", protect, authorize("admin", "manager"), locationController.deleteLocation);

module.exports = router;
