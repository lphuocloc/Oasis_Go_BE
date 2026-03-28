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
 *                 enum: [CLEANING, MAINTENANCE, OTHERS]
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
router.post("/", protect, supportRequestController.createSupportRequest);

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
 *           enum: [PENDING, IN_PROGRESS, RESOLVED]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [CLEANING, MAINTENANCE, OTHERS]
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
 *                 enum: [PENDING, IN_PROGRESS, RESOLVED]
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

module.exports = router;
