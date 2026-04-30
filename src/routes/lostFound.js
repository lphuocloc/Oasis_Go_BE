const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const { uploadIncidentMedia } = require("../config/cloudinary");
const {
  reportFoundItem,
  storeToWarehouse,
  submitLostItemRequest,
  confirmMatch,
  rejectLostItemRequest,
  generateHandoverOTP,
  confirmHandover,
  getLostFoundItems,
  getLostFoundItemById,
  getLostItemRequests,
  getLostItemRequestById,
} = require("../controllers/lostFoundController");

/**
 * @swagger
 * tags:
 *   name: Lost Found
 *   description: Lost & Found Management APIs
 */

// ─── Lấy danh sách Requests (User / Manager) ──────────────────────

/**
 * @swagger
 * /api/lost-found-items/requests:
 *   get:
 *     summary: Get lost item requests
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, MATCHED, CLOSED, REJECTED]
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
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
 *         description: Requests retrieved successfully
 */
router.get("/requests", protect, authorize("admin", "manager", "user"), getLostItemRequests);

// ─── Lấy chi tiết 1 Request ─────────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/requests/{id}:
 *   get:
 *     summary: Get lost item request detail
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
 *         description: Request retrieved successfully
 */
router.get("/requests/:id", protect, authorize("admin", "manager", "user"), getLostItemRequestById);

// ─── Tạo Request tìm đồ (User) ──────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/requests:
 *   post:
 *     summary: User submit a lost item request
 *     tags: [Lost Found]
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
 *               - item_name_reported
 *             properties:
 *               booking_id:
 *                 type: string
 *               item_name_reported:
 *                 type: string
 *               description_reported:
 *                 type: string
 *     responses:
 *       201:
 *         description: Request submitted successfully
 */
router.post("/requests", protect, authorize("user"), submitLostItemRequest);

// ─── Manager xác nhận Match Request ─────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/requests/{id}/match:
 *   post:
 *     summary: Manager confirms match for a request
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
 *             type: object
 *             required:
 *               - found_item_id
 *             properties:
 *               found_item_id:
 *                 type: string
 *               manager_note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Matched successfully
 */
router.post("/requests/:id/match", protect, authorize("admin", "manager"), confirmMatch);

// ─── Manager từ chối Request ────────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/requests/{id}/reject:
 *   post:
 *     summary: Manager rejects a request
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
 *             type: object
 *             properties:
 *               manager_note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rejected successfully
 */
router.post("/requests/:id/reject", protect, authorize("admin", "manager"), rejectLostItemRequest);

// ─── Lấy danh sách LostFoundItems (Manager/Cleaner) ───────────────

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
 *         name: warehouse_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: serial_number
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [FOUND, IN_STORAGE, CLAIM_PENDING, RETURNED, DISPOSED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lost & found items retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getLostFoundItems);

// ─── Lấy chi tiết 1 LostFoundItem ───────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/{id}:
 *   get:
 *     summary: Get lost & found item detail
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
 *         description: Item retrieved successfully
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getLostFoundItemById);

// ─── Báo cáo tìm đồ (Cleaner) ───────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items:
 *   post:
 *     summary: Báo cáo đồ thất lạc (Cleaner/Manager)
 *     tags: [Lost Found]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - pod_id
 *               - item_name
 *             properties:
 *               pod_id:
 *                 type: string
 *               item_name:
 *                 type: string
 *               description:
 *                 type: string
 *               found_at:
 *                 type: string
 *                 format: date-time
 *               media:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Item reported successfully
 */
router.post(
  "/",
  protect,
  authorize("admin", "manager", "cleaner"),
  uploadIncidentMedia.array("media", 5),
  reportFoundItem
);

// ─── Manager Cất đồ vào kho ─────────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/{id}/store:
 *   post:
 *     summary: Manager stores item to warehouse
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
 *             type: object
 *             required:
 *               - warehouse_id
 *             properties:
 *               warehouse_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Stored successfully
 */
router.post("/:id/store", protect, authorize("admin", "manager"), storeToWarehouse);

// ─── Manager Tạo OTP Bàn giao ───────────────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/{id}/generate-otp:
 *   post:
 *     summary: Manager generates handover OTP for user
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
 *         description: OTP generated successfully
 */
router.post("/:id/generate-otp", protect, authorize("admin", "manager"), generateHandoverOTP);

// ─── Manager Xác nhận Handover bằng OTP ─────────────────────────────

/**
 * @swagger
 * /api/lost-found-items/{id}/handover:
 *   post:
 *     summary: Manager confirms handover with OTP
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
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Handover completed successfully
 */
router.post("/:id/handover", protect, authorize("admin", "manager"), confirmHandover);

module.exports = router;
