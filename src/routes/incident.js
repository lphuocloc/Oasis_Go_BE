const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope, applyManagerPodScope } = require("../middlewares/managerScopeMiddleware");
const { uploadIncidentMedia } = require("../config/cloudinary");
const {
  createIncident,
  getDamageReports,
  getMyPendingIncidentReviews,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  getCleanerIncidentDetail,
  getCheckinReportsByCleaner,
  updateCleanerIncidentStatus,
  resolveReplenishment,
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
 *           enum: [PENDING, RESOLVED, DISMISSED]
 *           example: PENDING
 *         incident_type:
 *           type: string
 *           enum: [OPERATIONAL, DAMAGE_REPORT]
 *           example: DAMAGE_REPORT
 *         details:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ITEM, SERVICE]
 *               item_id:
 *                 type: string
 *                 nullable: true
 *               service_catalog_id:
 *                 type: string
 *                 nullable: true
 *               name_snapshot:
 *                 type: string
 *                 nullable: true
 *               unit_cost_snapshot:
 *                 type: number
 *               quantity:
 *                 type: integer
 *               total_cost:
 *                 type: number
 *               note:
 *                 type: string
 *                 nullable: true
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
 *           example: ITEM_SUMMARY_SNAPSHOT
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
 *         media:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *           description: Optional media files (ảnh hoặc video) uploaded directly to Cloudinary. Hỗ trợ jpg/png/webp và mp4/mov/webm, tối đa 8 files, mỗi file tối đa 100MB.
 *         photo_urls:
 *           type: array
 *           items:
 *             type: string
 *           description: Optional pre-uploaded URLs. Can also be JSON-stringified array in multipart form-data
 *
 *     DamageReportCreateInput:
 *       type: object
 *       required:
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
 *         details:
 *           type: array
 *           description: Canonical payload. Supports both ITEM and SERVICE lines in a single report.
 *           minItems: 1
 *           items:
 *             type: object
 *             required:
 *               - type
 *               - quantity
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ITEM, SERVICE]
 *                 example: ITEM
 *               item_id:
 *                 type: string
 *                 nullable: true
 *                 description: Required when type = ITEM.
 *               service_catalog_id:
 *                 type: string
 *                 nullable: true
 *                 description: Optional when type = SERVICE. If sent, must exist and be active.
 *               name_snapshot:
 *                 type: string
 *                 nullable: true
 *                 description: Required when type = SERVICE and service_catalog_id is not provided.
 *               unit_cost_snapshot:
 *                 type: number
 *                 nullable: true
 *                 minimum: 0
 *                 description: Required when type = SERVICE and no base price can be resolved from catalog.
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *               note:
 *                 type: string
 *                 nullable: true
 *           example:
 *             - type: ITEM
 *               item_id: 2f9e6d3c-7f54-4f7f-a2c0-dc7bf6e4a1f1
 *               quantity: 2
 *               note: Vo be ly
 *             - type: SERVICE
 *               service_catalog_id: 7c32c3cc-32b1-4f5a-90f1-20d8f5e3961a
 *               quantity: 1
 *               note: Phi khu mui thuoc la
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
 *         media:
 *           type: array
 *           items:
 *             type: string
 *             format: binary
 *           description: Ảnh hoặc video upload trực tiếp (tối đa 8 files, 100MB/file). Hỗ trợ jpg/png/webp và mp4/mov/webm.
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
 *           enum: [PENDING, RESOLVED, DISMISSED]
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
 *         details:
 *           type: array
 *           description: Canonical incident detail lines persisted in incident_details.
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ITEM, SERVICE]
 *               item_id:
 *                 type: string
 *                 nullable: true
 *               service_catalog_id:
 *                 type: string
 *                 nullable: true
 *               name_snapshot:
 *                 type: string
 *                 nullable: true
 *               unit_cost_snapshot:
 *                 type: number
 *               quantity:
 *                 type: integer
 *               total_cost:
 *                 type: number
 *               note:
 *                 type: string
 *                 nullable: true
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
 *               example: ITEM_SUMMARY_SNAPSHOT
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
 *           enum: [PENDING, RESOLVED, DISMISSED]
 *           example: RESOLVED
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
 *           enum: [PENDING, RESOLVED, DISMISSED]
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
 * /api/incidents:
 *   post:
 *     summary: Create incident (canonical endpoint)
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
 *                   $ref: '#/components/schemas/DamageReportResponse'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Pod, item, service catalog, or cleaning task not found
 */
router.post(
  "/",
  protect,
  authorize("admin", "manager", "cleaner"),
  uploadIncidentMedia.array("media", 8),
  createIncident
);

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
 *           enum: [PENDING, RESOLVED, DISMISSED]
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
 * /api/incidents/my-pending-reviews:
 *   get:
 *     summary: Get pending incident reviews in manager scope
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
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
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
 *         description: Pending incident reviews retrieved successfully
 */
router.get(
  "/my-pending-reviews",
  protect,
  authorize("manager"),
  loadManagerScope,
  applyManagerPodScope,
  getMyPendingIncidentReviews
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
/**
 * @swagger
 * /api/incidents/cleaner/checkin-reports:
 *   get:
 *     summary: "[Cleaner] Get all CHECKIN_REPORT incidents for a cleaning task assigned to the cleaner"
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cleaning_task_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The cleaning task ID assigned to the logged-in cleaner
 *     responses:
 *       200:
 *         description: Checkin reports retrieved successfully
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
 *                   type: object
 *                   properties:
 *                     cleaning_task:
 *                       type: object
 *                     incidents:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Incident'
 *       403:
 *         description: Cleaning task not assigned to this cleaner
 *       404:
 *         description: Cleaning task not found
 */
router.get(
  "/cleaner/checkin-reports",
  protect,
  authorize("cleaner"),
  getCheckinReportsByCleaner
);

/**
 * @swagger
 * /api/incidents/cleaner/{id}:
 *   get:
 *     summary: "[Cleaner] Get incident detail enriched with booking and cleaning task info"
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
 *         description: Incident detail retrieved successfully
 *       403:
 *         description: Not allowed to access this incident
 *       404:
 *         description: Incident not found
 */
router.get("/cleaner/:id", protect, authorize("cleaner"), getCleanerIncidentDetail);

/**
 * @swagger
 * /api/incidents/cleaner/{id}/status:
 *   patch:
 *     summary: "[Cleaner] Update incident status (PENDING → PROCESSING → COMPLETED)"
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
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PROCESSING, COMPLETED]
 *                 example: PROCESSING
 *               resolution_note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Incident status updated successfully
 *       400:
 *         description: Invalid status transition
 *       403:
 *         description: Not allowed to update this incident
 *       404:
 *         description: Incident not found
 */
router.patch("/cleaner/:id/status", protect, authorize("cleaner"), updateCleanerIncidentStatus);

router.get("/:id", protect, authorize("admin", "manager", "cleaner"), loadManagerScope, getIncidentById);

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
router.patch("/:id/status", protect, authorize("admin", "manager"), loadManagerScope, updateIncidentStatus);

/**
 * @swagger
 * /api/incidents/{id}/resolve-replenishment:
 *   patch:
 *     summary: Resolve replenishment incident (Cleaner only)
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
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - item_id
 *                     - quantity
 *                   properties:
 *                     item_id:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Replenishment resolved successfully
 *       400:
 *         description: Invalid input or no active shift/warehouse found
 *       404:
 *         description: Incident not found
 */
router.patch("/:id/resolve-replenishment", protect, authorize("cleaner"), resolveReplenishment);

module.exports = router;

