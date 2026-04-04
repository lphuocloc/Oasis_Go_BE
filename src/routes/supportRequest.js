const express = require("express");
const router = express.Router();
const supportRequestController = require("../controllers/supportRequestController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope } = require("../middlewares/managerScopeMiddleware");

/**
 * @swagger
 * /api/support-requests:
 *   post:
 *     summary: Create support request for a booking
 *     tags: [SupportRequests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - booking_id
 *               - type
 *               - description
 *             properties:
 *               booking_id:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [MAINTENANCE, CHANGE_POD]
 *               description:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Support request created
 */
router.post("/", protect, authorize("user"), supportRequestController.createSupportRequest);

/**
 * @swagger
 * /api/support-requests:
 *   get:
 *     summary: Get support requests for manager scope
 *     tags: [SupportRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, ESCALATED, RESOLVED, REJECTED]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [MAINTENANCE, CHANGE_POD]
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Support requests retrieved
 */
router.get(
	"/",
	protect,
	authorize("manager"),
	loadManagerScope,
	supportRequestController.getSupportRequests
);

/**
 * @swagger
 * /api/support-requests/{id}/status:
 *   patch:
 *     summary: Manager updates support request status in assigned location
 *     tags: [SupportRequests]
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
 *                 enum: [PENDING, PROCESSING, ESCALATED, RESOLVED, REJECTED]
 *     responses:
 *       200:
 *         description: Support request updated
 */
router.patch(
	"/:id/status",
	protect,
	authorize("manager"),
	loadManagerScope,
	supportRequestController.updateSupportRequestStatus
);

/**
 * @swagger
 * /api/support-requests/{id}/room-change-candidates:
 *   get:
 *     summary: Get replacement pod candidates for emergency room change
 *     tags: [SupportRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Support request ID
 *     responses:
 *       200:
 *         description: Room-change candidates retrieved
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
 *                   type: object
 *                   properties:
 *                     request:
 *                       type: object
 *                     booking:
 *                       type: object
 *                     current_pod:
 *                       type: object
 *                     candidates:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           pod_id:
 *                             type: string
 *                           pod_code:
 *                             type: string
 *                           pod_name:
 *                             type: string
 *                           cluster_id:
 *                             type: string
 *                           location_id:
 *                             type: string
 *                           scope_level:
 *                             type: string
 *                             enum: [SAME_CLUSTER, SAME_PARENT_LOCATION]
 *                           buffer_minutes_applied:
 *                             type: integer
 *                           remaining_time_start:
 *                             type: string
 *                             format: date-time
 *                           remaining_time_end_with_buffer:
 *                             type: string
 *                             format: date-time
 *       400:
 *         description: Invalid request state or unsupported support type
 *       403:
 *         description: Not allowed to access request outside manager scope
 *       404:
 *         description: Support request, booking, pod, or cluster not found
 */
router.get(
	"/:id/room-change-candidates",
	protect,
	authorize("manager"),
	loadManagerScope,
	supportRequestController.getRoomChangeCandidates
);

/**
 * @swagger
 * /api/support-requests/{id}/room-change:
 *   patch:
 *     summary: Execute emergency room change for a support request
 *     tags: [SupportRequests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Support request ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - target_pod_id
 *             properties:
 *               target_pod_id:
 *                 type: string
 *                 description: Replacement pod ID
 *               severity:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *                 description: Required as HIGH or CRITICAL for MAINTENANCE room-change
 *               old_pod_next_status:
 *                 type: string
 *                 enum: [MAINTENANCE, NEEDS_CLEANING]
 *                 description: Desired status for old pod after move
 *               old_pod_reason:
 *                 type: string
 *                 description: Optional maintenance reason for old pod
 *               escalation_note:
 *                 type: string
 *                 description: Required when resulting support status is ESCALATED
 *               resolution_note:
 *                 type: string
 *                 description: Optional resolution summary, auto-generated if omitted
 *     responses:
 *       200:
 *         description: Emergency room change completed
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
 *                   type: object
 *                   properties:
 *                     support_request:
 *                       type: object
 *                     booking:
 *                       type: object
 *                     old_pod:
 *                       type: object
 *                     new_pod:
 *                       type: object
 *                     buffer_minutes_applied:
 *                       type: integer
 *                     escalated_to_admin:
 *                       type: boolean
 *       400:
 *         description: Invalid payload, invalid transition, or room-change constraints failed
 *       403:
 *         description: Not allowed to execute room-change outside manager scope
 *       404:
 *         description: Support request, booking, pod, or cluster not found
 *       409:
 *         description: Target pod has booking or timeslot conflicts
 */
router.patch(
	"/:id/room-change",
	protect,
	authorize("manager"),
	loadManagerScope,
	supportRequestController.executeRoomChange
);

module.exports = router;
