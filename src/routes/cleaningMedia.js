const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createCleaningPhoto,
  getAllCleaningPhotos,
  getCleaningPhotoById,
  updateCleaningPhoto,
  deleteCleaningPhoto,
} = require("../controllers/cleaningMediaController");

const uploadCleaningMediaInMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB to support video
  },
});

const handleCleaningMediaUpload = (req, res, next) => {
  uploadCleaningMediaInMemory.fields([
    { name: "media", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "image", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();

    const isMulterError = error && error.name === "MulterError";
    const statusCode = isMulterError ? 400 : 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Error uploading cleaning media",
      error_code: isMulterError ? "UPLOAD_VALIDATION_ERROR" : "UPLOAD_FAILED",
    });
  });
};

/**
 * @swagger
 * tags:
 *   name: Cleaning Media
 *   description: CRUD for cleaning media (photo and video) management
 */

/**
 * @swagger
 * /api/cleaning-media:
 *   get:
 *     summary: Get all cleaning media
 *     tags: [Cleaning Media]
 *     parameters:
 *       - in: query
 *         name: cleaning_task_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: media_type
 *         schema:
 *           type: string
 *           enum: [BEFORE, AFTER]
 *       - in: query
 *         name: file_type
 *         schema:
 *           type: string
 *           enum: [IMAGE, VIDEO]
 *     responses:
 *       200:
 *         description: Cleaning media retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getAllCleaningPhotos);

/**
 * @swagger
 * /api/cleaning-media/{id}:
 *   get:
 *     summary: Get cleaning media by ID
 *     tags: [Cleaning Media]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cleaning media retrieved successfully
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getCleaningPhotoById);

/**
 * @swagger
 * /api/cleaning-media:
 *   post:
 *     summary: Create cleaning media (photo or video)
 *     tags: [Cleaning Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - cleaning_task_id
 *               - media_type
 *               - media
 *             properties:
 *               cleaning_task_id:
 *                 type: string
 *               media_type:
 *                 type: string
 *                 enum: [BEFORE, AFTER]
 *               file_type:
 *                 type: string
 *                 enum: [IMAGE, VIDEO]
 *               media:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Cleaning media created successfully
 */
router.post(
  "/",
  protect,
  authorize("admin", "manager", "cleaner"),
  handleCleaningMediaUpload,
  createCleaningPhoto
);

/**
 * @swagger
 * /api/cleaning-media/{id}:
 *   put:
 *     summary: Update cleaning media
 *     tags: [Cleaning Media]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               cleaning_task_id:
 *                 type: string
 *               media_type:
 *                 type: string
 *                 enum: [BEFORE, AFTER]
 *               file_type:
 *                 type: string
 *                 enum: [IMAGE, VIDEO]
 *               media:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Cleaning media updated successfully
 */
router.put(
  "/:id",
  protect,
  authorize("admin", "manager", "cleaner"),
  handleCleaningMediaUpload,
  updateCleaningPhoto
);

/**
 * @swagger
 * /api/cleaning-media/{id}:
 *   delete:
 *     summary: Delete cleaning media
 *     tags: [Cleaning Media]
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
 *         description: Cleaning media deleted successfully
 */
router.delete("/:id", protect, authorize("admin", "manager"), deleteCleaningPhoto);

module.exports = router;
