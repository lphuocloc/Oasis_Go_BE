const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope, applyManagerPodScope } = require("../middlewares/managerScopeMiddleware");
const { uploadIncidentPhoto } = require("../config/cloudinary");
const {
  createIncidentFromCleaningTask,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
} = require("../controllers/incidentController");

/**
 * @swagger
 * tags:
 *   name: Incidents
 *   description: Incident reporting and tracking during cleaning operations
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Incident:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 4cb307ea-4f40-498d-ab5e-c6df09d0d640
 *         pod_id:
 *           type: string
 *           example: 8f1a7c3f-9d42-4418-aa0f-f129eb0e2b8d
 *         booking_id:
 *           type: string
 *           nullable: true
 *           example: 98484f31-7549-42fd-8df8-a692bd3da3a4
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *           example: 129bc093-80fd-4eb7-9f04-d3e2c2390ef8
 *         shift_assignment_id:
 *           type: string
 *           nullable: true
 *           example: bcecab72-b131-4ec3-a86f-b5d247f0f067
 *         reported_by:
 *           type: string
 *           example: 87098f0d-a69a-466f-b9c4-9e44383d5882
 *         description:
 *           type: string
 *           example: Broken glass near pod table
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *           example: HIGH
 *         status:
 *           type: string
 *           enum: [PENDING, INVESTIGATING, RESOLVED, CLOSED]
 *           example: PENDING
 *         has_lost_found:
 *           type: boolean
 *           example: true
 *         photo_urls:
 *           type: array
 *           items:
 *             type: string
 *           example:
 *             - https://res.cloudinary.com/demo/image/upload/v1/oasisgo/incidents/photo1.jpg
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     IncidentCreateFromCleaningTaskInput:
 *       type: object
 *       required:
 *         - cleaning_task_id
 *         - description
 *       properties:
 *         cleaning_task_id:
 *           type: string
 *           example: 129bc093-80fd-4eb7-9f04-d3e2c2390ef8
 *         description:
 *           type: string
 *           example: AC panel cracked and unsafe
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *           default: MEDIUM
 *         photos:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *           description: Optional files uploaded directly to Cloudinary
 *         photo_urls:
 *           type: array
 *           items:
 *             type: string
 *           description: Optional pre-uploaded URLs. Can also be JSON-stringified array in multipart form-data
 *
 *     IncidentStatusUpdateInput:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [PENDING, INVESTIGATING, RESOLVED, CLOSED]
 *           example: INVESTIGATING
 */

/**
 * @swagger
 * /api/incidents:
 *   get:
 *     summary: Get incidents with filters
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: cleaning_task_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: reported_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, INVESTIGATING, RESOLVED, CLOSED]
 *     responses:
 *       200:
 *         description: Incident list retrieved successfully
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
 *                     $ref: '#/components/schemas/Incident'
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, applyManagerPodScope, getIncidents);

/**
 * @swagger
 * /api/incidents/{id}:
 *   get:
 *     summary: Get incident detail by id
 *     tags: [Incidents]
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
 *         description: Incident retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Incident'
 *       404:
 *         description: Incident not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, getIncidentById);

/**
 * @swagger
 * /api/incidents/cleaning-task:
 *   post:
 *     summary: Cleaner reports incident from a cleaning task
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/IncidentCreateFromCleaningTaskInput'
 *     responses:
 *       201:
 *         description: Incident created successfully
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
 *                   $ref: '#/components/schemas/Incident'
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Cleaner is not allowed for this task
 */
router.post(
  "/cleaning-task",
  protect,
  authorize("admin", "manager", "cleaner"),
  uploadIncidentPhoto.array("photos", 8),
  createIncidentFromCleaningTask
);

/**
 * @swagger
 * /api/incidents/{id}/status:
 *   patch:
 *     summary: Update incident status
 *     tags: [Incidents]
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
 *             $ref: '#/components/schemas/IncidentStatusUpdateInput'
 *     responses:
 *       200:
 *         description: Incident status updated successfully
 *       404:
 *         description: Incident not found
 */
router.patch("/:id/status", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, updateIncidentStatus);

module.exports = router;
