const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createLostFoundItem,
  getLostFoundItems,
  getMyLostFoundItems,
  getLostFoundItemById,
  updateLostFoundStatus,
} = require("../controllers/lostFoundController");

const uploadLostFoundMediaInMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB to support video
});

const handleLostFoundMediaUpload = (req, res, next) => {
  uploadLostFoundMediaInMemory.fields([
    { name: "media", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "image", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();
    const isMulterError = error && error.name === "MulterError";
    const statusCode = isMulterError ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      message: isMulterError ? error.message : "File upload error",
    });
  });
};

/**
 * @swagger
 * tags:
 *   name: Lost Found
 *   description: Found-item workflow independent from incident reporting
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LostFoundItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 9c9f1555-f20f-4e1d-b597-c8f6f421648d
 *         pod_id:
 *           type: string
 *           nullable: true
 *           example: 8f1a7c3f-9d42-4418-aa0f-f129eb0e2b8d
 *         booking_id:
 *           type: string
 *           nullable: true
 *           example: 98484f31-7549-42fd-8df8-a692bd3da3a4
 *         found_by_user_id:
 *           type: string
 *           example: 87098f0d-a69a-466f-b9c4-9e44383d5882
 *         warehouse_id:
 *           type: string
 *           nullable: true
 *           example: d4e5f6a7-b8c9-4d0e-a1b2-c3d4e5f6a7b8
 *         item_name:
 *           type: string
 *           example: iPhone 14 Pro
 *         description:
 *           type: string
 *           nullable: true
 *           example: Black color phone found under seat
 *         photo_url:
 *           type: string
 *           nullable: true
 *           example: https://res.cloudinary.com/oasisgo/lost-found/item.jpg
 *         found_at:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [FOUND, CLAIMED, DISPOSED, RETURNED_TO_USER]
 *           example: FOUND
 *         claimed_by_user_id:
 *           type: string
 *           nullable: true
 *         claimed_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     LostFoundCreateInput:
 *       type: object
 *       required:
 *         - item_name
 *       properties:
 *         pod_id:
 *           type: string
 *           nullable: true
 *           example: 8f1a7c3f-9d42-4418-aa0f-f129eb0e2b8d
 *         booking_id:
 *           type: string
 *           nullable: true
 *           example: 98484f31-7549-42fd-8df8-a692bd3da3a4
 *         warehouse_id:
 *           type: string
 *           nullable: true
 *           description: Kho cơ sở nơi lưu giữ đồ vật
 *           example: d4e5f6a7-b8c9-4d0e-a1b2-c3d4e5f6a7b8
 *         item_name:
 *           type: string
 *           example: Wallet
 *         description:
 *           type: string
 *           example: Brown leather wallet with card holder
 *         photo:
 *           type: string
 *           format: binary
 *           description: Ảnh thực tế món đồ (multipart/form-data). Nếu không upload file, có thể truyền photo_url hoặc base64 data URI.
 *         photo_url:
 *           type: string
 *           nullable: true
 *           description: URL ảnh trực tiếp hoặc base64 data URI (dùng thay cho field photo)
 *           example: https://res.cloudinary.com/oasisgo/lost-found/item.jpg
 *         found_at:
 *           type: string
 *           format: date-time
 *
 *     LostFoundStatusUpdateInput:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [FOUND, CLAIMED, DISPOSED, RETURNED_TO_USER]
 *           example: CLAIMED
 */

/**
 * @swagger
 * /api/lost-found-items:
 *   get:
 *     summary: Get lost & found items with filters
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: found_by_user_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [FOUND, CLAIMED, DISPOSED, RETURNED_TO_USER]
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
 *         description: Lost & found items retrieved successfully
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
 *                     $ref: '#/components/schemas/LostFoundItem'
 *                 pagination:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_items:
 *                       type: integer
 *                     items_per_page:
 *                       type: integer
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getLostFoundItems);

/**
 * @swagger
 * /api/lost-found-items:
 *   post:
 *     summary: Báo cáo đồ thất lạc tìm được (Cleaner/Manager/Admin)
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/LostFoundCreateInput'
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LostFoundCreateInput'
 *     responses:
 *       201:
 *         description: Tạo lost & found item thành công
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
 *                   $ref: '#/components/schemas/LostFoundItem'
 *       400:
 *         description: Thiếu thông tin bắt buộc hoặc ảnh không hợp lệ
 *       404:
 *         description: Pod không tồn tại
 *       413:
 *         description: Ảnh vượt quá giới hạn 8MB
 */
router.post("/", protect, authorize("admin", "manager", "cleaner"), handleLostFoundMediaUpload, createLostFoundItem);

/**
 * @swagger
 * /api/lost-found-items/my:
 *   get:
 *     summary: Lấy danh sách đồ thất lạc do tôi tìm thấy
 *     description: Trả về tất cả các món đồ mà người dùng đang đăng nhập đã báo cáo tìm thấy. Hỗ trợ filter theo status và phân trang.
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [FOUND, CLAIMED, DISPOSED, RETURNED_TO_USER]
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
 *         description: Danh sách đồ tìm thấy của tôi
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
 *                     $ref: '#/components/schemas/LostFoundItem'
 *                 pagination:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_items:
 *                       type: integer
 *                     items_per_page:
 *                       type: integer
 */
router.get("/my", protect, authorize("admin", "manager", "cleaner"), getMyLostFoundItems);

/**
 * @swagger
 * /api/lost-found-items/{id}:
 *   get:
 *     summary: Get lost & found detail by id
 *     tags: [Lost Found]
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
 *         description: Lost & found item retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/LostFoundItem'
 *       404:
 *         description: Lost & found item not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getLostFoundItemById);

/**
 * @swagger
 * /api/lost-found-items/{id}/status:
 *   patch:
 *     summary: Update lost & found status
 *     tags: [Lost Found]
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
 *             $ref: '#/components/schemas/LostFoundStatusUpdateInput'
 *     responses:
 *       200:
 *         description: Lost & found status updated successfully
 *       404:
 *         description: Lost & found item not found
 */
router.patch("/:id/status", protect, authorize("admin", "manager", "cleaner"), updateLostFoundStatus);

module.exports = router;
