const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const staffShiftAssignmentController = require("../controllers/staffShiftAssignmentController");

/**
 * @swagger
 * tags:
 *   name: Staff Shift Assignments
 *   description: Assignment operation endpoints
 */

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
 * components:
 *   schemas:
 *     StaffShiftActionRequest:
 *       type: object
 *       required:
 *         - shift_assignment_id
 *       properties:
 *         shift_assignment_id:
 *           type: string
 *           example: 33c9a292-67b7-4a4b-944e-0f57f9a7d09d
 */

/**
 * @swagger
 * /api/staff-shift-assignments/admin/assign-manager:
 *   post:
 *     summary: Admin assigns manager to shifts configured on the parent location
 *     tags: [Staff Shift Assignments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - staff_id
 *               - parent_location_id
 *               - work_date
 *             properties:
 *               staff_id:
 *                 type: string
 *                 description: Manager user id
 *               parent_location_id:
 *                 type: string
 *                 description: Parent location id to assign manager directly
 *               shift_id:
 *                 type: string
 *                 description: Optional filter for a specific staff shift id
 *               work_date:
 *                 type: string
 *                 format: date
 *           example:
 *             staff_id: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *             parent_location_id: 8f2ce391-f69c-4f5f-a65e-fd35f0c4ef10
 *             work_date: 2026-03-17
 *     responses:
 *       201:
 *         description: Assignment created successfully
 *       400:
 *         description: Invalid input or no location_shift available on parent location
 *       404:
 *         description: Staff, shift, or parent location not found
 */
router.post(
  "/admin/assign-manager",
  protect,
  authorize("admin"),
  staffShiftAssignmentController.assignManager
);

/**
 * @swagger
 * /api/staff-shift-assignments/checkin:
 *   post:
 *     summary: Staff/Cleaner check in for assigned shift assignment
 *     tags: [Staff Shift Assignments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shift_assignment_id
 *             properties:
 *               shift_assignment_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check-in successful
 *       400:
 *         description: Invalid check-in request
 *       403:
 *         description: Not allowed to check in this assignment
 *       404:
 *         description: Shift assignment not found
 */
router.post(
  "/checkin",
  protect,
  authorize("manager", "cleaner"),
  staffShiftAssignmentController.checkinWork
);

/**
 * @swagger
 * /api/staff-shift-assignments/checkout:
 *   post:
 *     summary: Staff/Cleaner check out for assigned shift assignment
 *     tags: [Staff Shift Assignments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffShiftActionRequest'
 *     responses:
 *       200:
 *         description: Check-out successful
 *       400:
 *         description: Invalid check-out request
 *       403:
 *         description: Not allowed to check out this assignment
 *       404:
 *         description: Shift assignment not found
 */
router.post(
  "/checkout",
  protect,
  authorize("manager", "cleaner"),
  staffShiftAssignmentController.checkoutWork
);

module.exports = router;
