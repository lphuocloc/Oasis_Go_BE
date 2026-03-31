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
 *           enum: [ASSIGNED, NOTIFIED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
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
 *                     properties:
 *                       id:
 *                         type: string
 *                       pod_id:
 *                         type: string
 *                       booking_id:
 *                         type: string
 *                       cleaner_id:
 *                         type: string
 *                       estimated_start_time:
 *                         type: string
 *                         format: date-time
 *                       due_at:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                       request_source:
 *                         type: string
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
 *           enum: [ASSIGNED, NOTIFIED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
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
 *                     properties:
 *                       id:
 *                         type: string
 *                       pod_id:
 *                         type: string
 *                       booking_id:
 *                         type: string
 *                       estimated_start_time:
 *                         type: string
 *                         format: date-time
 *                       due_at:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 */
router.get("/me", protect, authorize("cleaner", "manager", "admin"), getMyCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/backfill:
 *   post:
 *     summary: Backfill cleaning tasks for old bookings (supports one booking to many tasks)
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Create missing cleaning tasks from historical bookings using trigger SYSTEM_RETRY_BACKFILL.
 *       This endpoint now supports one booking to many cleaning tasks.
 *       To avoid unlimited duplication from retries, backfill skips a booking only when a SYSTEM_RETRY task already exists.
 *       It does not skip just because the booking already has tasks from other sources.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dry_run:
 *                       type: boolean
 *                     scanned:
 *                       type: integer
 *                     created_count:
 *                       type: integer
 *                     skipped_count:
 *                       type: integer
 *                     failed_count:
 *                       type: integer
 *                     skipped:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           booking_id:
 *                             type: string
 *                           reason:
 *                             type: string
 *                             example: ALREADY_BACKFILLED
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
 *     description: |
 *       Returns diagnostic information for auto-assignment without creating/updating records.
 *       Current business rules reflected in diagnostics:
 *       - One booking can have many cleaning tasks.
 *       - For cleaner-access triggers (SET_CLEANER_ACCESS_TRUE, BOOKING_UPDATED_CLEANER_ACCESS_TRUE),
 *         request_source becomes USER_REQUEST only when booking.status is IN_USE and checkin_state is not NO_SHOW.
 *       - If booking checkin_state is NO_SHOW, no new task is created.
 *         In real execution (not dry-run), open tasks for that booking are moved to CANCELLED.
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
 *     responses:
 *       200:
 *         description: Diagnostic result generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     auto_assign_diagnostic:
 *                       type: object
 *                       properties:
 *                         reason:
 *                           type: string
 *                           example: DRY_RUN_ELIGIBLE
 *                         preview:
 *                           type: object
 *                           properties:
 *                             request_source:
 *                               type: string
 *                               enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY]
 *                             estimated_start_time:
 *                               type: string
 *                               format: date-time
 *                             due_at:
 *                               type: string
 *                               format: date-time
 *                             status:
 *                               type: string
 *                               enum: [ASSIGNED, NOTIFIED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     pod_id:
 *                       type: string
 *                     booking_id:
 *                       type: string
 *                     cleaner_id:
 *                       type: string
 *                     estimated_start_time:
 *                       type: string
 *                       format: date-time
 *                     due_at:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pod_id
 *               - cleaner_id
 *             properties:
 *               pod_id:
 *                 type: string
 *                 description: Pod ID
 *               booking_id:
 *                 type: string
 *                 description: Optional booking ID
 *               cleaner_id:
 *                 type: string
 *                 description: Cleaner ID
 *               shift_assignment_id:
 *                 type: string
 *                 description: Optional shift assignment ID
 *               request_source:
 *                 type: string
 *                 enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY]
 *                 description: Request source
 *               estimated_start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Estimated start time for the cleaning task
 *               due_at:
 *                 type: string
 *                 format: date-time
 *                 description: Due timestamp for task completion
 *               status:
 *                 type: string
 *                 enum: [ASSIGNED, NOTIFIED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *                 description: Task status
 *               note:
 *                 type: string
 *                 description: Optional note
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
 *         description: Cleaning task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pod_id:
 *                 type: string
 *               booking_id:
 *                 type: string
 *               cleaner_id:
 *                 type: string
 *               shift_assignment_id:
 *                 type: string
 *               request_source:
 *                 type: string
 *                 enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY]
 *               estimated_start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Estimated start time for the cleaning task
 *               due_at:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [ASSIGNED, NOTIFIED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *               assigned_at:
 *                 type: string
 *                 format: date-time
 *               notified_at:
 *                 type: string
 *                 format: date-time
 *               accepted_at:
 *                 type: string
 *                 format: date-time
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               note:
 *                 type: string
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
