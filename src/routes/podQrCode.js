const express = require("express");
const router = express.Router();
const podQrCodeController = require("../controllers/podQrCodeController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod QR Codes
 *   description: Pod QR code management endpoints
 */

/**
 * @swagger
 * /api/pod-qr-codes/generate-by-cluster/{clusterId}:
 *   post:
 *     summary: Generate pod QR codes for all pods in a cluster
 *     tags: [Pod QR Codes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clusterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *         example: 5f7a1f0b9f1b2c0017a7a001
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *                 description: Expiry time for generated QR codes (must be in the future)
 *                 example: 2026-03-18T23:59:59.000Z
 *               is_active:
 *                 type: boolean
 *                 description: Whether generated QR codes are active
 *                 example: true
 *               deactivate_existing:
 *                 type: boolean
 *                 description: Deactivate existing active QR codes in this cluster before generating new ones
 *                 example: true
 *     responses:
 *       201:
 *         description: Pod QR codes generated successfully
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
 *                   example: Pod QR codes generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     cluster_id:
 *                       type: string
 *                     cluster_name:
 *                       type: string
 *                     total_pods:
 *                       type: integer
 *                     created_count:
 *                       type: integer
 *                     expires_at:
 *                       type: string
 *                       format: date-time
 *                     is_active:
 *                       type: boolean
 *                     deactivate_existing:
 *                       type: boolean
 *                     created_qr_codes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           pod_id:
 *                             type: string
 *                           qr_token:
 *                             type: string
 *                           expires_at:
 *                             type: string
 *                             format: date-time
 *                           is_active:
 *                             type: boolean
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       400:
 *         description: Invalid request (invalid clusterId or expires_at)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin or manager only)
 *       404:
 *         description: Pod cluster not found or no pods in cluster
 *       500:
 *         description: Server error
 */

router
  .route("/generate-by-cluster/:clusterId")
  .post(protect, authorize("admin", "manager"), podQrCodeController.generateQrCodesByPodCluster);

 * components:
 *   schemas:
 *     PodQrCode:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 57f52bf0-8dc4-4cb2-b5ac-e25049258a87
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         qr_token:
 *           type: string
 *           example: QRTOKEN-ABC-123
 *         expires_at:
 *           type: string
 *           format: date-time
 *         is_active:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PodQrCodeInput:
 *       type: object
 *       required:
 *         - pod_id
 *         - qr_token
 *         - expires_at
 *       properties:
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         qr_token:
 *           type: string
 *           example: QRTOKEN-ABC-123
 *         expires_at:
 *           type: string
 *           format: date-time
 *         is_active:
 *           type: boolean
 *           example: true
 */

/**
 * @swagger
 * /api/pod-qr-codes:
 *   get:
 *     summary: Get all pod QR codes
 *     tags: [Pod QR Codes]
 *     responses:
 *       200:
 *         description: Pod QR codes retrieved successfully
 */

/**
 * @swagger
 * /api/pod-qr-codes:
 *   post:
 *     summary: Create pod QR code
 *     tags: [Pod QR Codes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PodQrCodeInput'
 *     responses:
 *       201:
 *         description: Pod QR code created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/")
  .get(podQrCodeController.getAllQrCodes)
  .post(protect, authorize("admin", "manager"), podQrCodeController.createQrCode);

/**
 * @swagger
 * /api/pod-qr-codes/{id}:
 *   get:
 *     summary: Get pod QR code by ID
 *     tags: [Pod QR Codes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pod QR code retrieved successfully
 *       404:
 *         description: Pod QR code not found
 */

/**
 * @swagger
 * /api/pod-qr-codes/{id}:
 *   put:
 *     summary: Update pod QR code by ID
 *     tags: [Pod QR Codes]
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
 *             $ref: '#/components/schemas/PodQrCodeInput'
 *     responses:
 *       200:
 *         description: Pod QR code updated successfully
 *       404:
 *         description: Pod QR code not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/pod-qr-codes/{id}:
 *   delete:
 *     summary: Delete pod QR code by ID
 *     tags: [Pod QR Codes]
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
 *         description: Pod QR code deleted successfully
 *       404:
 *         description: Pod QR code not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/:id")
  .get(podQrCodeController.getQrCodeById)
  .put(protect, authorize("admin", "manager"), podQrCodeController.updateQrCode)
  .delete(protect, authorize("admin", "manager"), podQrCodeController.deleteQrCode);

module.exports = router;
