const express = require("express");
const router = express.Router();
const timeSlotController = require("../controllers/timeSlotController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: TimeSlots
 *   description: Time slot management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TimeSlot:
 *       type: object
 *       required:
 *         - pod_id
 *         - start_time
 *         - end_time
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier (UUID)
 *         pod_id:
 *           type: string
 *           description: Reference to Pod ID
 *         start_time:
 *           type: string
 *           format: date-time
 *           description: Start time of the slot
 *         end_time:
 *           type: string
 *           format: date-time
 *           description: End time of the slot
 *         status:
 *           type: string
 *           enum: [AVAILABLE, RESERVED]
 *           default: AVAILABLE
 *           description: Status of the time slot
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/timeslots:
 *   get:
 *     summary: Get all time slots with optional filters
 *     tags: [TimeSlots]
 *     parameters:
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *         description: Filter by pod ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [AVAILABLE, RESERVED]
 *         description: Filter by status
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter slots starting from this date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter slots ending before this date
 *     responses:
 *       200:
 *         description: List of time slots
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
 *                     $ref: '#/components/schemas/TimeSlot'
 *   post:
 *     summary: Create a new time slot
 *     tags: [TimeSlots]
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
 *               - start_time
 *               - end_time
 *             properties:
 *               pod_id:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, RESERVED]
 *     responses:
 *       201:
 *         description: Time slot created successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pod not found
 */
router.route("/")
    .get(timeSlotController.getAllTimeSlots)
    .post(protect, authorize("admin", "manager"), timeSlotController.createTimeSlot);

/**
 * @swagger
 * /api/timeslots/available/{podId}:
 *   get:
 *     summary: Get available time slots for a specific pod
 *     tags: [TimeSlots]
 *     parameters:
 *       - in: path
 *         name: podId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod ID
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for availability check
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for availability check
 *     responses:
 *       200:
 *         description: List of available time slots
 *       400:
 *         description: Missing required query parameters
 */
router.get("/available/:podId", timeSlotController.getAvailableSlots);

/**
 * @swagger
 * /api/timeslots/generate/{podId}:
 *   post:
 *     summary: Generate time slots for a pod
 *     tags: [TimeSlots]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: podId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days:
 *                 type: integer
 *                 default: 7
 *                 description: Number of days to generate slots for
 *     responses:
 *       201:
 *         description: Time slots generated successfully
 *       404:
 *         description: Pod not found
 */
router.post("/generate/:podId", protect, authorize("admin", "manager"), timeSlotController.generateSlotsForPod);

/**
 * @swagger
 * /api/timeslots/reserve:
 *   post:
 *     summary: Reserve time slots
 *     tags: [TimeSlots]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - slotIds
 *             properties:
 *               slotIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of time slot IDs to reserve
 *     responses:
 *       200:
 *         description: Time slots reserved successfully
 *       400:
 *         description: Invalid input
 */
router.post("/reserve", protect, timeSlotController.reserveSlots);

/**
 * @swagger
 * /api/timeslots/release:
 *   post:
 *     summary: Release reserved time slots
 *     tags: [TimeSlots]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - slotIds
 *             properties:
 *               slotIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of time slot IDs to release
 *     responses:
 *       200:
 *         description: Time slots released successfully
 *       400:
 *         description: Invalid input
 */
router.post("/release", protect, timeSlotController.releaseSlots);

/**
 * @swagger
 * /api/timeslots/cluster/{clusterId}/available:
 *   get:
 *     summary: Find available slots by cluster using gap-based logic
 *     description: Returns all time slots for a specific date with availability status. Shows AVAILABLE if at least one pod is free, UNAVAILABLE if all pods are booked. Includes 30-minute buffer time after each booking for cleaning.
 *     tags: [TimeSlots]
 *     parameters:
 *       - in: path
 *         name: clusterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Cluster ID
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-03-15"
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: Available slots retrieved successfully
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
 *                   example: "Available slots retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       example: "2026-03-15"
 *                     cluster_id:
 *                       type: string
 *                     total_pods:
 *                       type: integer
 *                       description: Total number of pods in cluster
 *                     total_slots:
 *                       type: integer
 *                       description: Total number of slots in the day
 *                     available_slots_count:
 *                       type: integer
 *                       description: Number of slots with at least one pod available
 *                     unavailable_slots_count:
 *                       type: integer
 *                       description: Number of slots with no pods available
 *                     slots:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           start_time:
 *                             type: string
 *                             format: date-time
 *                           end_time:
 *                             type: string
 *                             format: date-time
 *                           status:
 *                             type: string
 *                             enum: [AVAILABLE, UNAVAILABLE]
 *                           available_pods_count:
 *                             type: integer
 *                           available_pods:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 pod_id:
 *                                   type: string
 *                                 pod_code:
 *                                   type: string
 *                                 pod_name:
 *                                   type: string
 *       400:
 *         description: Invalid date format or missing parameters
 *       404:
 *         description: Cluster not found
 */
router.get("/cluster/:clusterId/available", timeSlotController.findAvailableSlotsByCluster);

/**
 * @swagger
 * /api/timeslots/{id}:
 *   get:
 *     summary: Get a time slot by ID
 *     tags: [TimeSlots]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Time slot ID
 *     responses:
 *       200:
 *         description: Time slot details
 *       404:
 *         description: Time slot not found
 *   put:
 *     summary: Update a time slot
 *     tags: [TimeSlots]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Time slot ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, RESERVED]
 *     responses:
 *       200:
 *         description: Time slot updated successfully
 *       404:
 *         description: Time slot not found
 *   delete:
 *     summary: Delete a time slot
 *     tags: [TimeSlots]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Time slot ID
 *     responses:
 *       200:
 *         description: Time slot deleted successfully
 *       400:
 *         description: Cannot delete reserved slot
 *       404:
 *         description: Time slot not found
 */
router.route("/:id")
    .get(timeSlotController.getTimeSlotById)
    .put(protect, authorize("admin", "manager"), timeSlotController.updateTimeSlot)
    .delete(protect, authorize("admin", "manager"), timeSlotController.deleteTimeSlot);

module.exports = router;
