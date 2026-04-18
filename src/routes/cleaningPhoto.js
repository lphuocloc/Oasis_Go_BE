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
} = require("../controllers/cleaningPhotoController");

const uploadCleaningPhotoInMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

const handleCleaningPhotoUpload = (req, res, next) => {
  uploadCleaningPhotoInMemory.fields([
    { name: "photo", maxCount: 1 },
    { name: "image", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();

    const isMulterError = error && error.name === "MulterError";
    const statusCode = isMulterError ? 400 : 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Error uploading cleaning photo",
      error_code: isMulterError ? "UPLOAD_VALIDATION_ERROR" : "UPLOAD_FAILED",
    });
  });
};

/**
 * @swagger
 * tags:
 *   name: Cleaning Photos
 *   description: Basic CRUD for cleaning photo management
 */

/**
 * @swagger
 * /api/cleaning-photos:
 *   get:
 *     summary: Get all cleaning photos
 *     tags: [Cleaning Photos]
 *     parameters:
 *       - in: query
 *         name: cleaning_task_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [BEFORE, AFTER]
 *     responses:
 *       200:
 *         description: Cleaning photos retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getAllCleaningPhotos);

/**
 * @swagger
 * /api/cleaning-photos/{id}:
 *   get:
 *     summary: Get cleaning photo by ID
 *     tags: [Cleaning Photos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cleaning photo retrieved successfully
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getCleaningPhotoById);

/**
 * @swagger
 * /api/cleaning-photos:
 *   post:
 *     summary: Create cleaning photo
 *     tags: [Cleaning Photos]
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
 *               - type
 *               - photo
 *             properties:
 *               cleaning_task_id:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [BEFORE, AFTER]
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Cleaning photo created successfully
 */
router.post(
  "/",
  protect,
  authorize("admin", "manager", "cleaner"),
  handleCleaningPhotoUpload,
  createCleaningPhoto
);

/**
 * @swagger
 * /api/cleaning-photos/{id}:
 *   put:
 *     summary: Update cleaning photo
 *     tags: [Cleaning Photos]
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
 *               type:
 *                 type: string
 *                 enum: [BEFORE, AFTER]
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Cleaning photo updated successfully
 */
router.put(
  "/:id",
  protect,
  authorize("admin", "manager", "cleaner"),
  handleCleaningPhotoUpload,
  updateCleaningPhoto
);

/**
 * @swagger
 * /api/cleaning-photos/{id}:
 *   delete:
 *     summary: Delete cleaning photo
 *     tags: [Cleaning Photos]
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
 *         description: Cleaning photo deleted successfully
 */
router.delete("/:id", protect, authorize("admin", "manager"), deleteCleaningPhoto);

module.exports = router;
