const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createCleaningPhoto,
  getAllCleaningPhotos,
  getCleaningPhotoById,
  updateCleaningPhoto,
  deleteCleaningPhoto,
} = require("../controllers/cleaningPhotoController");

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
 *     responses:
 *       201:
 *         description: Cleaning photo created successfully
 */
router.post("/", protect, authorize("admin", "manager", "cleaner"), createCleaningPhoto);

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
 *     responses:
 *       200:
 *         description: Cleaning photo updated successfully
 */
router.put("/:id", protect, authorize("admin", "manager", "cleaner"), updateCleaningPhoto);

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
