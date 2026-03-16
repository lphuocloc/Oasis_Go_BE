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

/**
 * @swagger
 * /api/identity/reset-identity:
 *   delete:
 *     summary: Reset thông tin định danh (CCCD)
 *     description: Xóa bản ghi IdentityCard của người dùng hiện tại và gỡ liên kết identityCard trong bảng User.
 *     tags:
 *       - Identity
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reset định danh thành công
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
 *                   example: "Đã reset định danh thành công. Bạn có thể thực hiện định danh mới."
 *       404:
 *         description: Không tìm thấy thông tin định danh để xóa
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
 *                   example: "Không tìm thấy thông tin định danh để reset."
 *       401:
 *         description: Unauthorized - Chưa đăng nhập hoặc token hết hạn
 *       500:
 *         description: Lỗi hệ thống khi xử lý
 */
router.delete("/reset-identity", protect, identityController.resetIdentity);
/**
 * @swagger
 * /api/identity/me:
 *   get:
 *     summary: Lấy thông tin định danh chi tiết của người dùng hiện tại
 *     tags:
 *       - Identity
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lấy dữ liệu thành công
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
 *         description: Chưa xác thực (Token không hợp lệ hoặc hết hạn)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Người dùng chưa thực hiện định danh
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
 *                   example: "Người dùng chưa thực hiện xác thực danh tính."
 *       500:
 *         description: Lỗi hệ thống
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/me", protect, identityController.getIdentity);

module.exports = router;
