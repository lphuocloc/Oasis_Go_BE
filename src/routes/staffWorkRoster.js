const express = require("express");
const staffWorkRosterController = require("../controllers/staffWorkRosterController");
const authMiddleware = require("../middlewares/authMiddleware");
const { loadManagerScope } = require("../middlewares/managerScopeMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/staff-work-rosters:
 *   post:
 *     summary: Create a staff roster
 *     description: >
 *       Assign a staff member to work a specific shift at a specific location on a specific day of week.
 *       This defines the recurring weekly pattern (e.g., staff works MORNING shift at Location A every Monday).
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staff_id:
 *                 type: string
 *                 description: Staff member ID
 *                 example: "123e4567-e89b-12d3-a456-426614174000"
 *               location_shift_id:
 *                 type: string
 *                 description: Location Shift ID (links location + shift template)
 *                 example: "123e4567-e89b-12d3-a456-426614174001"
 *               day_of_week:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 6
 *                 description: Day of week (0=Sunday, 1=Monday, ...6=Saturday)
 *                 example: 1
 *               days_of_week:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Array of day integers (0 to 6) avoiding creating same roster layout multiple times.
 *                 example: [1, 2, 3, 4, 5]
 *               is_active:
 *                 type: boolean
 *                 description: Whether this roster entry is active
 *                 default: true
 *                 example: true
 *             required:
 *               - staff_id
 *               - location_shift_id
 *               - day_of_week
 *     responses:
 *       201:
 *         description: Roster created successfully
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
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     staff_id:
 *                       type: string
 *                     location_shift_id:
 *                       type: string
 *                     day_of_week:
 *                       type: integer
 *                     is_active:
 *                       type: boolean
 *                     created_at:
 *                       type: string
 *                       format: date-time
 */
router.post(
	"/",
	authMiddleware.protect,
	authMiddleware.authorize("admin", "manager"),
	loadManagerScope,
	staffWorkRosterController.createRoster
);

/**
 * @swagger
 * /api/staff-work-rosters:
 *   get:
 *     summary: Get all staff rosters
 *     description: Retrieve all staff rosters with optional filtering
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *         description: Filter by staff ID
 *       - in: query
 *         name: location_shift_id
 *         schema:
 *           type: string
 *         description: Filter by location shift ID
 *       - in: query
 *         name: day_of_week
 *         schema:
 *           type: integer
 *         description: Filter by day of week (0-6)
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of rosters retrieved successfully
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
 */
router.get(
	"/",
	authMiddleware.protect,
	authMiddleware.authorize("admin", "manager", "cleaner"),
	loadManagerScope,
	staffWorkRosterController.getAllRosters
);

/**
 * @swagger
 * /api/staff-work-rosters/me:
 *   get:
 *     summary: Get my rosters with full details (cleaner only)
 *     description: >
 *       Returns all roster entries assigned to the authenticated cleaner,
 *       each enriched with full shift info (name, start/end time),
 *       location info (name, address, type) and cluster info (name, description).
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of rosters with full details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       staff_id:
 *                         type: string
 *                       shift_id:
 *                         type: string
 *                       location_id:
 *                         type: string
 *                       cluster_id:
 *                         type: string
 *                       is_active:
 *                         type: boolean
 *                       is_temporary:
 *                         type: boolean
 *                       work_date:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       shift:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id:
 *                             type: string
 *                           shift_name:
 *                             type: string
 *                             example: "CA SÁNG"
 *                           start_time:
 *                             type: string
 *                             example: "06:00"
 *                           end_time:
 *                             type: string
 *                             example: "14:00"
 *                           is_active:
 *                             type: boolean
 *                       location:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           type:
 *                             type: string
 *                           address:
 *                             type: string
 *                           lat:
 *                             type: number
 *                           lng:
 *                             type: number
 *                       cluster:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
 *                           location_id:
 *                             type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden – not a cleaner
 */
router.get(
	"/me",
	authMiddleware.protect,
	authMiddleware.authorize("cleaner"),
	staffWorkRosterController.getMyRosters
);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   get:
 *     summary: Get a roster by ID
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roster ID
 *     responses:
 *       200:
 *         description: Roster retrieved successfully
 *       404:
 *         description: Roster not found
 */
router.get(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin", "manager", "cleaner"),
	loadManagerScope,
	staffWorkRosterController.getRosterById
);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   put:
 *     summary: Update a roster
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roster ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staff_id:
 *                 type: string
 *               location_shift_id:
 *                 type: string
 *               day_of_week:
 *                 type: integer
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Roster updated successfully
 *       404:
 *         description: Roster not found
 */
router.put(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin", "manager"),
	loadManagerScope,
	staffWorkRosterController.updateRoster
);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   delete:
 *     summary: Delete a roster
 *     tags: [Staff Roster]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roster ID
 *     responses:
 *       200:
 *         description: Roster deleted successfully
 *       404:
 *         description: Roster not found
 */
router.delete(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin", "manager"),
	loadManagerScope,
	staffWorkRosterController.deleteRoster
);

module.exports = router;
