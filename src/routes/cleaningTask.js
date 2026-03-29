const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope, applyManagerPodScope, requireManagerPodAccess } = require("../middlewares/managerScopeMiddleware");
const {
  createCleaningTask,
  getAllCleaningTasks,
  getMyCleaningTasks,
  getCleaningTaskById,
  updateCleaningTask,
  deleteCleaningTask,
  backfillCleaningTasks,
  debugAutoAssignForBooking,
} = require("../controllers/cleaningTaskController");

/**
 * @swagger
 * tags:
 *   name: Cleaning Tasks
 *   description: Basic CRUD for cleaning task management
 */

/**
 * @swagger
 * /api/cleaning-tasks:
 *   get:
 *     summary: Get all cleaning tasks (supports cleaner_id, shift_assignment_id, status, request_source, SLA range)
 *     tags: [Cleaning Tasks]
 *     parameters:
 *       - in: query
 *         name: cleaner_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: shift_assignment_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ASSIGNED, NOTIFIED, ACCEPTED, ARRIVED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *       - in: query
 *         name: request_source
 *         schema:
 *           type: string
 *           enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY]
 *       - in: query
 *         name: due_from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: due_to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Cleaning tasks retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, applyManagerPodScope, getAllCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/me:
 *   get:
 *     summary: Get my cleaning tasks (for logged-in cleaner)
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shift_assignment_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ASSIGNED, NOTIFIED, ACCEPTED, ARRIVED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *       - in: query
 *         name: request_source
 *         schema:
 *           type: string
 *           enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY]
 *       - in: query
 *         name: due_from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: due_to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: My cleaning tasks retrieved successfully
 */
router.get("/me", protect, authorize("cleaner", "manager", "admin"), getMyCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/backfill:
 *   post:
 *     summary: Backfill missing cleaning tasks for old bookings
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dry_run:
 *                 type: boolean
 *                 default: true
 *               cleaner_access_only:
 *                 type: boolean
 *                 default: true
 *               from_date:
 *                 type: string
 *                 format: date-time
 *               to_date:
 *                 type: string
 *                 format: date-time
 *               limit:
 *                 type: integer
 *                 default: 200
 *     responses:
 *       200:
 *         description: Backfill executed successfully
 */
router.post("/backfill", protect, authorize("admin", "manager"), backfillCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/debug/auto-assign/{bookingId}:
 *   get:
 *     summary: Diagnose auto-assignment pipeline for a booking (dry-run, no data mutation)
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: trigger
 *         schema:
 *           type: string
 *         description: Optional trigger label for diagnostic context
 *       - in: query
 *         name: ignore_existing_task_check
 *         schema:
 *           type: boolean
 *         description: Set true to continue pipeline checks even when a task already exists
 *     responses:
 *       200:
 *         description: Diagnostic result generated successfully
 */
router.get(
  "/debug/auto-assign/:bookingId",
  protect,
  authorize("admin", "manager"),
  debugAutoAssignForBooking
);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   get:
 *     summary: Get cleaning task by ID
 *     tags: [Cleaning Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cleaning task retrieved successfully
 *       404:
 *         description: Cleaning task not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, getCleaningTaskById);

/**
 * @swagger
 * /api/cleaning-tasks:
 *   post:
 *     summary: Create cleaning task
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Cleaning task created successfully
 */
router.post("/", protect, authorize("admin", "manager"), loadManagerScope, requireManagerPodAccess({ source: "body", key: "pod_id" }), createCleaningTask);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   put:
 *     summary: Update cleaning task
 *     tags: [Cleaning Tasks]
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
 *         description: Cleaning task updated successfully
 */
router.put("/:id", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, updateCleaningTask);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   delete:
 *     summary: Delete cleaning task
 *     tags: [Cleaning Tasks]
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
 *         description: Cleaning task deleted successfully
 */
router.delete("/:id", protect, authorize("admin"), deleteCleaningTask);

module.exports = router;
