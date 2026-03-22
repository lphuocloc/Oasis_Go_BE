const express = require("express");
const staffShiftAssignmentController = require("../controllers/staffShiftAssignmentController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/staff-shift-assignments/me:
 *   get:
 *     summary: Get my shift assignments (for manager/cleaner)
 *     tags: [Staff Shift Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: work_date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by a specific work date (YYYY-MM-DD)
 *       - in: query
 *         name: from_date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter start date (used with to_date)
 *       - in: query
 *         name: to_date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter end date (used with from_date)
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *         description: Comma-separated statuses (ASSIGNED,CHECKED_IN,COMPLETED,ABSENT)
 *     responses:
 *       200:
 *         description: My shift assignments retrieved successfully
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/me",
  protect,
  authorize("manager", "cleaner"),
  staffShiftAssignmentController.getMyAssignments
);

/**
 * @swagger
 * /api/staff-shift-assignments:
 *   post:
 *     summary: Create a shift assignment
 *     description: >
 *       Create a shift assignment for a staff member covering a specific date range.
 *       The assignment defines when a staff member will work a particular shift at a location.
 *     tags: [Staff Assignment]
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
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: Assignment start date (YYYY-MM-DD)
 *                 example: "2026-03-22"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: Assignment end date (YYYY-MM-DD)
 *                 example: "2026-03-29"
 *             required:
 *               - staff_id
 *               - location_shift_id
 *               - start_date
 *               - end_date
 *     responses:
 *       201:
 *         description: Assignment created successfully
 */
router.post(
	"/",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.createAssignment
);

/**
 * @swagger
 * /api/staff-shift-assignments/checkin:
 *   post:
 *     summary: Check in for a shift
 *     description: Record a staff member checking in to start their shift
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shift_assignment_id:
 *                 type: string
 *                 description: Assignment ID
 *                 example: "123e4567-e89b-12d3-a456-426614174002"
 *             required:
 *               - shift_assignment_id
 *     responses:
 *       200:
 *         description: Check-in successful
 */
router.post(
	"/checkin",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.checkinWork
);

/**
 * @swagger
 * /api/staff-shift-assignments/checkout:
 *   post:
 *     summary: Check out from a shift
 *     description: Record a staff member checking out to end their shift
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shift_assignment_id:
 *                 type: string
 *                 description: Assignment ID
 *                 example: "123e4567-e89b-12d3-a456-426614174002"
 *             required:
 *               - shift_assignment_id
 *     responses:
 *       200:
 *         description: Check-out successful
 */
router.post(
	"/checkout",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.checkoutWork
);

/**
 * @swagger
 * /api/staff-shift-assignments:
 *   get:
 *     summary: Get all shift assignments
 *     description: Retrieve all shift assignments with optional filtering
 *     tags: [Staff Assignment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: location_shift_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: List of assignments retrieved successfully
 */
router.get(
	"/",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.getAssignments
);

/**
 * @swagger
 * /api/staff-shift-assignments/{id}:
 *   get:
 *     summary: Get an assignment by ID
 *     tags: [Staff Assignment]
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
 *         description: Assignment retrieved successfully
 *       404:
 *         description: Assignment not found
 */
router.get(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.getAssignmentById
);

/**
 * @swagger
 * /api/staff-shift-assignments/{id}:
 *   put:
 *     summary: Update an assignment
 *     tags: [Staff Assignment]
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
 *             type: object
 *             properties:
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum:
 *                   - ASSIGNED
 *                   - CHECKED_IN
 *                   - COMPLETED
 *                   - ABSENT
 *     responses:
 *       200:
 *         description: Assignment updated successfully
 */
router.put(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.updateAssignment
);

/**
 * @swagger
 * /api/staff-shift-assignments/{id}:
 *   delete:
 *     summary: Delete an assignment
 *     tags: [Staff Assignment]
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
 *         description: Assignment deleted successfully
 */
router.delete(
	"/:id",
	authMiddleware.protect,
	authMiddleware.authorize("admin"),
	staffShiftAssignmentController.deleteAssignment
);

module.exports = router;
