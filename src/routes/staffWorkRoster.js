const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const staffWorkRosterController = require("../controllers/staffWorkRosterController");

/**
 * @swagger
 * tags:
 *   name: Staff Work Rosters
 *   description: Weekly fixed roster management for staff
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     StaffWorkRoster:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 2d2d5ace-f6ad-4759-a029-1e9a6bb0e4e8
 *         staff_id:
 *           type: string
 *           example: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *         location_shift_id:
 *           type: string
 *           example: 601f51a8-c9a8-4a1f-af07-55df27f519f5
 *         day_of_week:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *           description: 0 is Sunday, 1-6 is Monday-Saturday
 *           example: 1
 *         is_active:
 *           type: boolean
 *           example: true
 *         created_at:
 *           type: string
 *           format: date-time
 *           example: 2026-03-19T07:20:00.000Z
 *     StaffWorkRosterCreateRequest:
 *       type: object
 *       required:
 *         - staff_id
 *         - location_shift_id
 *         - day_of_week
 *       properties:
 *         staff_id:
 *           type: string
 *           description: User id of manager/cleaner
 *           example: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *         location_shift_id:
 *           type: string
 *           description: LocationShift id
 *           example: 601f51a8-c9a8-4a1f-af07-55df27f519f5
 *         day_of_week:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *           description: 0 is Sunday, 1-6 is Monday-Saturday
 *           example: 1
 *         is_active:
 *           type: boolean
 *           default: true
 *           example: true
 *     StaffWorkRosterUpdateRequest:
 *       type: object
 *       properties:
 *         staff_id:
 *           type: string
 *           example: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *         location_shift_id:
 *           type: string
 *           example: 601f51a8-c9a8-4a1f-af07-55df27f519f5
 *         day_of_week:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *           example: 2
 *         is_active:
 *           type: boolean
 *           example: false
 *     StaffWorkRosterListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         count:
 *           type: integer
 *           example: 2
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StaffWorkRoster'
 *     StaffWorkRosterSingleResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Staff roster created successfully
 *         data:
 *           $ref: '#/components/schemas/StaffWorkRoster'
 */

/**
 * @swagger
 * /api/staff-work-rosters:
 *   get:
 *     summary: Get all staff work rosters
 *     tags: [Staff Work Rosters]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staff_id
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by staff id
 *       - in: query
 *         name: location_shift_id
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by location shift id
 *       - in: query
 *         name: day_of_week
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *         description: Filter by day in week
 *       - in: query
 *         name: is_active
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Filter active/inactive roster
 *     responses:
 *       200:
 *         description: Staff rosters retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffWorkRosterListResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", protect, authorize("admin"), staffWorkRosterController.getAllRosters);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   get:
 *     summary: Get a staff roster by ID
 *     tags: [Staff Work Rosters]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Staff roster id
 *     responses:
 *       200:
 *         description: Staff roster retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/StaffWorkRoster'
 *       404:
 *         description: Roster not found
 */
router.get("/:id", protect, authorize("admin"), staffWorkRosterController.getRosterById);

/**
 * @swagger
 * /api/staff-work-rosters/create:
 *   post:
 *     summary: Create a fixed weekly roster for a staff
 *     tags: [Staff Work Rosters]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffWorkRosterCreateRequest'
 *           example:
 *             staff_id: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *             location_shift_id: 601f51a8-c9a8-4a1f-af07-55df27f519f5
 *             day_of_week: 1
 *             is_active: true
 *     responses:
 *       201:
 *         description: Staff roster created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffWorkRosterSingleResponse'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Staff or location shift not found
 *       409:
 *         description: Duplicate roster
 */
router.post("/create", protect, authorize("admin"), staffWorkRosterController.createRoster);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   put:
 *     summary: Update a staff roster
 *     tags: [Staff Work Rosters]
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
 *             $ref: '#/components/schemas/StaffWorkRosterUpdateRequest'
 *           example:
 *             day_of_week: 2
 *             is_active: false
 *     responses:
 *       200:
 *         description: Staff roster updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffWorkRosterSingleResponse'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Roster, staff or location shift not found
 *       409:
 *         description: Duplicate roster
 */
router.put("/:id", protect, authorize("admin"), staffWorkRosterController.updateRoster);

/**
 * @swagger
 * /api/staff-work-rosters/{id}:
 *   delete:
 *     summary: Delete a staff roster
 *     tags: [Staff Work Rosters]
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
 *         description: Staff roster deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Staff roster deleted successfully
 *       404:
 *         description: Roster not found
 */
router.delete("/:id", protect, authorize("admin"), staffWorkRosterController.deleteRoster);

module.exports = router;
