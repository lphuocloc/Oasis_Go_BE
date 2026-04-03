const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope, applyManagerPodScope } = require("../middlewares/managerScopeMiddleware");
const { uploadIncidentPhoto } = require("../config/cloudinary");
const {
  createIncidentFromCleaningTask,
  createDamageReport,
  getDamageReports,
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
 *         incident_type:
 *           type: string
 *           enum: [OPERATIONAL, DAMAGE_REPORT]
 *           example: DAMAGE_REPORT
 *         item_id:
 *           type: string
 *           nullable: true
 *           example: 2f9e6d3c-7f54-4f7f-a2c0-dc7bf6e4a1f1
 *         item_name_snapshot:
 *           type: string
 *           nullable: true
 *           example: Glass Cup
 *         unit_cost_snapshot:
 *           type: number
 *           nullable: true
 *           example: 25000
 *         quantity_affected:
 *           type: number
 *           nullable: true
 *           example: 2
 *         estimated_item_value:
 *           type: number
 *           nullable: true
 *           example: 50000
 *         estimated_service_fee:
 *           type: number
 *           nullable: true
 *           example: 10000
 *         estimated_total_value:
 *           type: number
 *           nullable: true
 *           example: 60000
 *         pricing_source:
 *           type: string
 *           nullable: true
 *           example: ITEM_UNIT_COST
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
 *     DamageReportCreateInput:
 *       type: object
 *       required:
 *         - item_id
 *         - description
 *       properties:
 *         cleaning_task_id:
 *           type: string
 *           nullable: true
 *           description: Optional. If provided, pod_id can be inferred from the task.
 *         pod_id:
 *           type: string
 *           nullable: true
 *           description: Required when cleaning_task_id is not provided.
 *         booking_id:
 *           type: string
 *           nullable: true
 *         item_id:
 *           type: string
 *           example: 2f9e6d3c-7f54-4f7f-a2c0-dc7bf6e4a1f1
 *         quantity_affected:
 *           type: number
 *           minimum: 1
 *           default: 1
 *         estimated_service_fee:
 *           type: number
 *           minimum: 0
 *           default: 0
 *         description:
 *           type: string
 *           example: Broken glass panel on the side wall
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *           default: MEDIUM
 *         photos:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *         photo_urls:
 *           type: array
 *           items:
 *             type: string
 *
 *     DamageReportResponse:
 *       type: object
 *       properties:
 *         report_id:
 *           type: string
 *         incident_type:
 *           type: string
 *           enum: [DAMAGE_REPORT]
 *         status:
 *           type: string
 *           enum: [PENDING, INVESTIGATING, RESOLVED, CLOSED]
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *         description:
 *           type: string
 *         context:
 *           type: object
 *           properties:
 *             pod_id:
 *               type: string
 *             pod_name:
 *               type: string
 *               nullable: true
 *             booking_id:
 *               type: string
 *               nullable: true
 *             cleaning_task_id:
 *               type: string
 *               nullable: true
 *             reported_by:
 *               type: string
 *             user_id:
 *               type: string
 *               description: The cleaner user id who created the report
 *             user_name:
 *               type: string
 *               nullable: true
 *             cleaner_name:
 *               type: string
 *               nullable: true
 *         item:
 *           type: object
 *           properties:
 *             item_id:
 *               type: string
 *             item_name_snapshot:
 *               type: string
 *             unit_cost_snapshot:
 *               type: number
 *             quantity_affected:
 *               type: number
 *         pricing:
 *           type: object
 *           properties:
 *             estimated_item_value:
 *               type: number
 *             estimated_service_fee:
 *               type: number
 *             estimated_total_value:
 *               type: number
 *             currency:
 *               type: string
 *               example: VND
 *             pricing_source:
 *               type: string
 *               example: ITEM_UNIT_COST
 *         photo_urls:
 *           type: array
 *           items:
 *             type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
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
 *         name: incident_type
 *         schema:
 *           type: string
 *           enum: [OPERATIONAL, DAMAGE_REPORT]
 *       - in: query
 *         name: item_id
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
 * /api/incidents/damage-reports:
 *   get:
 *     summary: Get damage reports with FE-friendly response format
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_ids
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: cleaning_task_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: item_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: reported_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, INVESTIGATING, RESOLVED, CLOSED]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Damage reports retrieved successfully
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
 *                     $ref: '#/components/schemas/DamageReportResponse'
 */
router.get(
  "/damage-reports",
  protect,
  authorize("admin", "manager", "cleaner"),
  loadManagerScope,
  applyManagerPodScope,
  getDamageReports
);

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
 * /api/incidents/damage-report:
 *   post:
 *     summary: Create damage report with item price snapshot
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/DamageReportCreateInput'
 *     responses:
 *       201:
 *         description: Damage report created successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pod, item, or cleaning task not found
 */
router.post(
  "/damage-report",
  protect,
  authorize("admin", "manager", "cleaner"),
  uploadIncidentPhoto.array("photos", 8),
  createDamageReport
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
