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
 *     summary: Admin generates weekly manager assignments from active roster in scoped location/shift
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
 *                 description: Parent location id used to scope location_shift
 *               shift_id:
 *                 type: string
 *                 description: Optional staff shift id filter inside location scope
 *               work_date:
 *                 type: string
 *                 format: date
 *                 description: Any date in target week; system will auto-calculate week_start_date (Sunday)
 *           example:
 *             staff_id: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *             parent_location_id: 8f2ce391-f69c-4f5f-a65e-fd35f0c4ef10
 *             work_date: 2026-03-17
 *     responses:
 *       201:
 *         description: Weekly assignments generated successfully from manager roster
 *       400:
 *         description: Invalid input, no valid manager location_shift, or no active roster in scope
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
 * /api/staff-shift-assignments/admin/generate-weekly-from-roster:
 *   post:
 *     summary: Generate one-week shift assignments from active staff roster
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
 *               - week_start_date
 *             properties:
 *               staff_id:
 *                 type: string
 *                 description: Staff user id
 *               week_start_date:
 *                 type: string
 *                 format: date
 *                 description: Sunday date of target week (day 0)
 *           example:
 *             staff_id: 3128f3f2-6c4f-4f3d-a6c8-df1b2d6ef734
 *             week_start_date: 2026-03-22
 *     responses:
 *       201:
 *         description: Weekly assignments generated successfully
 *       400:
 *         description: Invalid request or roster not found
 *       404:
 *         description: Staff not found
 */
router.post(
  "/admin/generate-weekly-from-roster",
  protect,
  authorize("admin"),
  staffShiftAssignmentController.generateWeeklyAssignmentsFromRoster
);

/**
 * @swagger
 * /api/staff-shift-assignments/checkin:
 *   post:
 *     summary: Staff/Cleaner check in for assigned shift assignment (create CHECKIN log)
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
 *         description: Check-in successful and CHECKIN attendance log created
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
 *     summary: Staff/Cleaner check out for assigned shift assignment (requires CHECKIN log)
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
 *         description: Check-out successful and CHECKOUT attendance log created
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
