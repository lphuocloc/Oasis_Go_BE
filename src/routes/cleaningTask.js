const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope, applyManagerPodScope, requireManagerPodAccess } = require("../middlewares/managerScopeMiddleware");
const {
  createCleaningTask,
  getAllCleaningTasks,
  getMyCleaningTasks,
  getCleanerTasksByBookingForManager,
  getCleaningTaskWithMedia,
  getMyCleanerKeyByTaskId,
  getCleaningTaskById,
  updateCleaningTask,
  deleteCleaningTask,
  backfillCleaningTasks,
  rejectCleaningTask,
  reassignCleaningTask,
} = require("../controllers/cleaningTaskController");
const bookingChecklistController = require("../controllers/bookingChecklistController");

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
 *           enum: [ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *       - in: query
 *         name: request_source
 *         schema:
 *           type: string
 *           enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY, ROOM_CHANGE_VACATED]
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
 *                       pod_name:
 *                         type: string
 *                         nullable: true
 *                       pod_cluster_id:
 *                         type: string
 *                         nullable: true
 *                       pod_cluster_name:
 *                         type: string
 *                         nullable: true
 *                       location_id:
 *                         type: string
 *                         nullable: true
 *                       location_name:
 *                         type: string
 *                         nullable: true
 *                       booking_guest_id:
 *                         type: string
 *                         nullable: true
 *                       booking_guest_name:
 *                         type: string
 *                         nullable: true
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
 *           enum: [ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *       - in: query
 *         name: request_source
 *         schema:
 *           type: string
 *           enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY, ROOM_CHANGE_VACATED]
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
 *                       cleaner_id:
 *                         type: string
 *                       pod_name:
 *                         type: string
 *                         nullable: true
 *                       pod_cluster_id:
 *                         type: string
 *                         nullable: true
 *                       pod_cluster_name:
 *                         type: string
 *                         nullable: true
 *                       location_id:
 *                         type: string
 *                         nullable: true
 *                       location_name:
 *                         type: string
 *                         nullable: true
 *                       booking_order_id:
 *                         type: string
 *                         nullable: true
 *                       booking_guest_id:
 *                         type: string
 *                         nullable: true
 *                       booking_guest_name:
 *                         type: string
 *                         nullable: true
 *                       booking_user_name:
 *                         type: string
 *                         nullable: true
 *                       booking_status:
 *                         type: string
 *                         nullable: true
 *                         description: Status of the linked booking (e.g. BOOKED, IN_USE, COMPLETED, CANCELLED)
 *                       pod_status:
 *                         type: string
 *                         nullable: true
 *                         description: Current status of the pod (e.g. AVAILABLE, IN_USE, NEEDS_CLEANING, CLEANING)
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
 * /api/cleaning-tasks/manager/cleaner-booking:
 *   get:
 *     summary: Get all cleaning tasks by booking (manager)
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *       - in: query
 *         name: request_source
 *         schema:
 *           type: string
 *           enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY, ROOM_CHANGE_VACATED]
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
 *       400:
 *         description: Missing booking_id
 */
router.get(
  "/manager/cleaner-booking",
  protect,
  authorize("manager", "admin"),
  loadManagerScope,
  applyManagerPodScope,
  getCleanerTasksByBookingForManager,
);

/**
 * @swagger
 * /api/cleaning-tasks/{id}/with-media:
 *   get:
 *     summary: Get cleaning task detail with before/after media
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
 *     responses:
 *       200:
 *         description: Cleaning task with media retrieved successfully
 *       404:
 *         description: Cleaning task not found
 */
router.get(
  "/:id/with-media",
  protect,
  authorize("admin", "manager", "cleaner"),
  loadManagerScope,
  getCleaningTaskWithMedia,
);

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
 * /api/cleaning-tasks/{id}/my-key:
 *   get:
 *     summary: Get cleaner online key by assigned cleaning task
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
 *         description: Cleaner key retrieved successfully
 *       403:
 *         description: Not allowed to retrieve key for this task
 *       404:
 *         description: Cleaning task or booking not found
 */
router.get("/:id/my-key", protect, authorize("cleaner"), getMyCleanerKeyByTaskId);

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
 *                     booking_order_id:
 *                       type: string
 *                       nullable: true
 *                     cleaner_id:
 *                       type: string
 *                     pod_name:
 *                       type: string
 *                       nullable: true
 *                     pod_cluster_name:
 *                       type: string
 *                       nullable: true
 *                     booking_guest_name:
 *                       type: string
 *                       nullable: true
 *                     booking_user_name:
 *                       type: string
 *                       nullable: true
 *                     booking_status:
 *                       type: string
 *                       nullable: true
 *                     pod_status:
 *                       type: string
 *                       nullable: true
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

 *               request_source:
 *                 type: string
 *                 enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY, ROOM_CHANGE_VACATED]
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
 *                 enum: [ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
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

 *               request_source:
 *                 type: string
 *                 enum: [USER_REQUEST, AUTO_AFTER_CHECKOUT, SYSTEM_RETRY, ROOM_CHANGE_VACATED]
 *               estimated_start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Estimated start time for the cleaning task
 *               due_at:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [ASSIGNED, ACCEPTED, IN_PROGRESS, DONE, CANCELLED, MISSED]
 *               assigned_at:
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
 * /api/cleaning-tasks/{id}/reject:
 *   post:
 *     summary: Cleaner rejects an assigned cleaning task
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Allows a cleaner to reject a task that is currently ASSIGNED or ACCEPTED.
 *       The task transitions to REJECTED status and managers at the location are notified.
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
 *             required:
 *               - rejection_reason
 *             properties:
 *               rejection_reason:
 *                 type: string
 *                 description: Reason the cleaner is rejecting this task
 *     responses:
 *       200:
 *         description: Task rejected successfully
 *       400:
 *         description: Missing rejection_reason or invalid status transition
 *       403:
 *         description: Not the assigned cleaner for this task
 *       404:
 *         description: Cleaning task not found
 */
router.post("/:id/reject", protect, authorize("cleaner"), rejectCleaningTask);

/**
 * @swagger
 * /api/cleaning-tasks/{id}/reassign:
 *   post:
 *     summary: Manager reassigns a REJECTED or MISSED cleaning task
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Allows a manager or admin to reassign a REJECTED, MISSED, or ASSIGNED cleaning task
 *       to a different cleaner. If `target_cleaner_id` is provided the task is manually assigned;
 *       otherwise the system auto-picks the best available cleaner via load balancing,
 *       excluding the cleaner who previously rejected the task.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Cleaning task ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               target_cleaner_id:
 *                 type: string
 *                 description: Specific cleaner to assign. Omit for auto load-balanced selection.

 *     responses:
 *       200:
 *         description: Task reassigned successfully
 *       400:
 *         description: Invalid status or no available cleaners
 *       403:
 *         description: Out of management scope
 *       404:
 *         description: Cleaning task or target cleaner not found
 */
router.post("/:id/reassign", protect, authorize("admin", "manager"), loadManagerScope, reassignCleaningTask);

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

/**
 * @swagger
 * /api/cleaning-tasks/{taskId}/damage-report:
 *   post:
 *     summary: Confirm damage report at checkout (Cleaner)
 *     description: Submit item inspection results at checkout. DAMAGED/MISSING items auto-create DAMAGE_REPORT incidents and notify managers.
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
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
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 description: JSON array of item results
 *                 items:
 *                   type: object
 *                   properties:
 *                     item_id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [MATCHED, DAMAGED, MISSING]
 *                     quantity:
 *                       type: number
 *     responses:
 *       200:
 *         description: Damage report confirmed
 *       400:
 *         description: Invalid payload or task status
 *       403:
 *         description: Not authorized for this task
 *       409:
 *         description: Damage report already completed
 */
router.post(
  "/:taskId/damage-report",
  protect,
  authorize("cleaner"),
  bookingChecklistController.confirmDamageReport
);

/**
 * @swagger
 * /api/cleaning-tasks/{taskId}/damage-report-items:
 *   get:
 *     summary: Get damage report items for checkout (Cleaner)
 *     description: Returns REUSABLE items for cleaner to inspect at checkout, enriched with the guest's replenishment request records.
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: Cleaning task ID
 *     responses:
 *       200:
 *         description: Damage report items retrieved
 *       403:
 *         description: Not authorized for this task
 *       404:
 *         description: Cleaning task not found
 */
router.get(
  "/:taskId/damage-report-items",
  protect,
  authorize("cleaner"),
  bookingChecklistController.getDamageReportItems
);

module.exports = router;
