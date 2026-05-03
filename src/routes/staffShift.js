const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const staffShiftController = require("../controllers/staffShiftController");

/**
 * @swagger
 * tags:
 *   name: Staff Shifts
 *   description: Staff shift management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     StaffShift:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 9ad0c39b-1db9-4bc4-8e4d-1f5f26f8eaca
 *         role:
 *           type: string
 *           enum: [CLEANER, MANAGER]
 *           example: MANAGER
 *         shift_name:
 *           type: string
 *           enum: [MORNING, AFTERNOON, NIGHT]
 *           example: MORNING
 *         start_time:
 *           type: string
 *           example: 06:00
 *         end_time:
 *           type: string
 *           example: 12:00
 *         is_active:
 *           type: boolean
 *           example: true
 *         created_at:
 *           type: string
 *           format: date-time
 *     StaffShiftCreateRequest:
 *       type: object
 *       required:
 *         - role
 *         - shift_name
 *         - start_time
 *         - end_time
 *       properties:
 *         role:
 *           type: string
 *           enum: [CLEANER, MANAGER]
 *         shift_name:
 *           type: string
 *           enum: [MORNING, AFTERNOON, NIGHT]
 *         start_time:
 *           type: string
 *           description: HH:mm or HH:mm:ss
 *           example: 06:00
 *         end_time:
 *           type: string
 *           description: HH:mm or HH:mm:ss
 *           example: 12:00
 *         is_active:
 *           type: boolean
 *           example: true
 */

/**
 * @swagger
 * /api/staff-shifts:
 *   get:
 *     summary: Get all staff shifts
 *     tags: [Staff Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         required: false
 *         schema:
 *           type: string
 *           enum: [CLEANER, MANAGER]
 *       - in: query
 *         name: is_active
 *         required: false
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Staff shifts retrieved successfully
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
 *                     $ref: '#/components/schemas/StaffShift'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router.get(
	"/",
	protect,
	authorize("admin", "manager"),
	staffShiftController.getAllStaffShifts
);

/**
 * @swagger
 * /api/staff-shifts/{id}:
 *   get:
 *     summary: Get one staff shift by ID
 *     tags: [Staff Shifts]
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
 *         description: Staff shift retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/StaffShift'
 *       404:
 *         description: Staff shift not found
 */

router.get(
	"/:id",
	protect,
	authorize("admin", "manager"),
	staffShiftController.getStaffShiftById
);

/**
 * @swagger
 * /api/staff-shifts/create:
 *   post:
 *     summary: Create a new staff shift
 *     tags: [Staff Shifts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffShiftCreateRequest'
 *           example:
 *             role: MANAGER
 *             shift_name: MORNING
 *             start_time: 06:00
 *             end_time: 12:00
 *             is_active: true
 *     responses:
 *       201:
 *         description: Staff shift created successfully
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
 *                   $ref: '#/components/schemas/StaffShift'
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Staff shift already exists
 */

router.post(
	"/create",
	protect,
	authorize("admin", "manager"),
	staffShiftController.createStaffShift
);

/**
 * @swagger
 * /api/staff-shifts/{id}:
 *   put:
 *     summary: Update an existing staff shift
 *     tags: [Staff Shifts]
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
 *             $ref: '#/components/schemas/StaffShiftCreateRequest'
 *           example:
 *             role: MANAGER
 *             shift_name: AFTERNOON
 *             start_time: 12:00
 *             end_time: 18:00
 *             is_active: true
 *     responses:
 *       200:
 *         description: Staff shift updated successfully
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
 *                   $ref: '#/components/schemas/StaffShift'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Staff shift not found
 *       409:
 *         description: Staff shift already exists
 */

router.put(
	"/:id",
	protect,
	authorize("admin", "manager"),
	staffShiftController.updateStaffShift
);

/**
 * @swagger
 * /api/staff-shifts/{id}:
 *   delete:
 *     summary: Delete a staff shift
 *     tags: [Staff Shifts]
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
 *         description: Staff shift deleted successfully
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
 *         description: Staff shift not found
 */

router.delete(
	"/:id",
	protect,
	authorize("admin", "manager"),
	staffShiftController.deleteStaffShift
);

module.exports = router;
