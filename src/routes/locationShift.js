const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
	loadManagerScope,
	requireManagerLocationAccess,
} = require("../middlewares/managerScopeMiddleware");
const locationShiftController = require("../controllers/locationShiftController");

/**
 * @swagger
 * tags:
 *   name: Location Shifts
 *   description: Location shift monitoring endpoints
 */

/**
 * @swagger
 * /api/location-shifts/create:
 *   post:
 *     summary: Create location-shift mapping (assign a staff shift to a location)
 *     tags: [Location Shifts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - location_id
 *               - shift_id
 *             properties:
 *               location_id:
 *                 type: string
 *                 description: Location id
 *               shift_id:
 *                 type: string
 *                 description: Staff shift id
 *           example:
 *             location_id: 8f2ce391-f69c-4f5f-a65e-fd35f0c4ef10
 *             shift_id: d7ab2d45-b9d9-4f8e-9e15-18fda9adf6d2
 *     responses:
 *       201:
 *         description: Location shift created successfully
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Location or staff shift not found
 *       409:
 *         description: Mapping already exists
 */
router.post(
	"/create",
	protect,
	authorize("admin", "manager"),
	loadManagerScope,
	requireManagerLocationAccess({ source: "body", key: "location_id" }),
	locationShiftController.createLocationShift
);

/**
 * @swagger
 * /api/location-shifts/locations/{locationId}/working:
 *   get:
 *     summary: Get staff currently working in a location
 *     tags: [Location Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: target_date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Return assignments whose date range covers this date
 *       - in: query
 *         name: role
 *         required: false
 *         schema:
 *           type: string
 *           enum: [CLEANER, MANAGER]
 *       - in: query
 *         name: include_assigned
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Include ASSIGNED staff (not checked in yet)
 *     responses:
 *       200:
 *         description: Working staff list returned successfully
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
 *                     type: object
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Location not found
 */
router.get(
	"/locations/:locationId/working",
	protect,
	authorize("admin", "manager"),
	loadManagerScope,
  requireManagerLocationAccess({ source: "params", key: "locationId" }),
  locationShiftController.getWorkingStaffByLocation
);

/**
 * @swagger
 * /api/location-shifts:
 *   get:
 *     summary: Get all location shifts
 *     tags: [Location Shifts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all location shifts retrieved successfully
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
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  protect,
  authorize("admin", "manager"),
  loadManagerScope,
  locationShiftController.getAllLocationShifts
);

/**
 * @swagger
 * /api/location-shifts/{id}:
 *   delete:
 *     summary: Delete a location shift mapping by ID
 *     tags: [Location Shifts]
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
 *         description: Location shift deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Location shift not found
 */
router.delete(
  "/:id",
  protect,
  authorize("admin", "manager"),
  locationShiftController.deleteLocationShift
);

module.exports = router;
