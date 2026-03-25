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
