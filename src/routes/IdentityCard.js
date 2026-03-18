const express = require("express");
const router = express.Router();
const identityController = require("../controllers/indentityController");
const { protect } = require("../middlewares/authMiddleware");
/**
 * @swagger
 * /api/identity/update-cccd:
 *   post:
 *     summary: Create or update identity information (Citizen ID)
 *     description: Upsert identity data. If the user has no identity record, create one; otherwise overwrite with new QR data.
 *     tags:
 *       - Identity
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - qrCode
 *               - infor
 *             properties:
 *               qrCode:
 *                 type: string
 *                 description: Raw string scanned from QR Code
 *                 example: "036095000123|Nguyễn Văn A|01011995|Nam|Hà Nội"
 *               infor:
 *                 type: object
 *                 required:
 *                   - idNumber
 *                 properties:
 *                   idNumber:
 *                     type: string
 *                     example: "036095000123"
 *                   fullName:
 *                     type: string
 *                     example: "Nguyễn Văn A"
 *                   dob:
 *                     type: string
 *                     example: "01/01/1995"
 *                   gender:
 *                     type: string
 *                     example: "Nam"
 *                   address:
 *                     type: string
 *                     example: "Hà Nội"
 *     responses:
 *       200:
 *         description: Identity verification successful
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
 *                   example: "Identity verification successful!"
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     userId:
 *                       type: string
 *                     qrRawData:
 *                       type: string
 *                     extractedInfo:
 *                       type: object
 *                     status:
 *                       type: string
 *                       example: "verified"
 *                     verifiedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid data or Citizen ID already in use
 *       401:
 *         description: Unauthorized - Invalid or expired token
 *       500:
 *         description: Server error
 */
router.post("/update-cccd", protect, identityController.updateIdentityFromQR);

/**
 * @swagger
 * /api/identity/reset-identity:
 *   delete:
 *     summary: Reset identity information
 *     description: Delete current user's IdentityCard record and unlink identityCard from User document.
 *     tags:
 *       - Identity
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Identity reset successfully
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
 *                   example: "Identity reset successfully. You can verify a new identity now."
 *       404:
 *         description: Identity information not found to delete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "No identity information found to reset."
 *       401:
 *         description: Unauthorized - Not logged in or token expired
 *       500:
 *         description: Internal server error
 */
router.delete("/reset-identity", protect, identityController.resetIdentity);
/**
 * @swagger
 * /api/identity/me:
 *   get:
 *     summary: Get current user's detailed identity information
 *     tags:
 *       - Identity
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     idNumber:
 *                       type: string
 *                       example: "012345678999"
 *                     fullName:
 *                       type: string
 *                       example: "NGUYỄN VĂN A"
 *                     dob:
 *                       type: string
 *                       example: "01/01/1990"
 *                     gender:
 *                       type: string
 *                       example: "Nam"
 *                     address:
 *                       type: string
 *                       example: "123 Đường ABC, Phường X, Quận Y, TP. Hồ Chí Minh"
 *       401:
 *         description: Unauthorized (invalid or expired token)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User has not completed identity verification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "User has not completed identity verification."
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/me", protect, identityController.getIdentity);

module.exports = router;
