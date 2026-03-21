const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createCleaningTask,
  getAllCleaningTasks,
  getMyCleaningTasks,
  getCleaningTaskById,
  updateCleaningTask,
  deleteCleaningTask,
} = require("../controllers/cleaningTaskController");

/**
 * @swagger
 * tags:
 *   name: Cleaning Tasks
 *   description: Basic CRUD for cleaning task management
 */

/**
 * @swagger
 * /api/cleaning-tasks:
 *   get:
 *     summary: Get all cleaning tasks (supports cleaner_id and shift_assignment_id filters)
 *     tags: [Cleaning Tasks]
 *     parameters:
 *       - in: query
 *         name: cleaner_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: shift_assignment_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ASSIGNED, IN_PROGRESS, DONE]
 *     responses:
 *       200:
 *         description: Cleaning tasks retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getAllCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/me:
 *   get:
 *     summary: Get my cleaning tasks (for logged-in cleaner)
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: shift_assignment_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: booking_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ASSIGNED, IN_PROGRESS, DONE]
 *     responses:
 *       200:
 *         description: My cleaning tasks retrieved successfully
 */
router.get("/me", protect, authorize("cleaner", "manager", "admin"), getMyCleaningTasks);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   get:
 *     summary: Get cleaning task by ID
 *     tags: [Cleaning Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cleaning task retrieved successfully
 *       404:
 *         description: Cleaning task not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getCleaningTaskById);

/**
 * @swagger
 * /api/cleaning-tasks:
 *   post:
 *     summary: Create cleaning task
 *     tags: [Cleaning Tasks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Cleaning task created successfully
 */
router.post("/", protect, authorize("admin", "manager"), createCleaningTask);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   put:
 *     summary: Update cleaning task
 *     tags: [Cleaning Tasks]
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
 *         description: Cleaning task updated successfully
 */
router.put("/:id", protect, authorize("admin", "manager"), updateCleaningTask);

/**
 * @swagger
 * /api/cleaning-tasks/{id}:
 *   delete:
 *     summary: Delete cleaning task
 *     tags: [Cleaning Tasks]
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
 *         description: Cleaning task deleted successfully
 */
router.delete("/:id", protect, authorize("admin"), deleteCleaningTask);

module.exports = router;
