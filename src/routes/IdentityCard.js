const express = require("express");
const router = express.Router();
const identityController = require("../controllers/indentityController");
const { protect } = require("../middlewares/authMiddleware");
/**
 * @swagger
 * /api/identity/update-cccd:
 *   post:
 *     summary: Cập nhật hoặc tạo mới thông tin định danh (CCCD)
 *     description: API thực hiện "Upsert" - Nếu User chưa có CCCD sẽ tạo mới, nếu có rồi sẽ ghi đè thông tin mới từ mã QR.
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
 *                 description: Chuỗi raw quét từ QR Code
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
 *         description: Xác thực thành công
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
 *                   example: "Xác thực danh tính thành công!"
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
 *         description: Dữ liệu không hợp lệ hoặc CCCD đã được sử dụng
 *       401:
 *         description: Unauthorized - Token không hợp lệ hoặc hết hạn
 *       500:
 *         description: Server Error - Lỗi hệ thống
 */
router.post("/update-cccd", protect, identityController.updateIdentityFromQR);

module.exports = router;
