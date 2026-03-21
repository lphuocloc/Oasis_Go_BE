const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createMaintenanceTask,
  getAllMaintenanceTasks,
  getMaintenanceTaskById,
  updateMaintenanceTask,
  deleteMaintenanceTask,
} = require("../controllers/maintenanceTaskController");

/**
 * @swagger
 * tags:
 *   name: Maintenance Tasks
 *   description: Basic CRUD for maintenance task management
 */

/**
 * @swagger
 * /api/maintenance-tasks:
 *   get:
 *     summary: Get all maintenance tasks
 *     tags: [Maintenance Tasks]
 *     parameters:
 *       - in: query
 *         name: reported_by
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, IN_PROGRESS, RESOLVED, CLOSED]
 *     responses:
 *       200:
 *         description: Maintenance tasks retrieved successfully
 */
router.get("/", protect, authorize("admin", "manager", "cleaner"), getAllMaintenanceTasks);

/**
 * @swagger
 * /api/maintenance-tasks/{id}:
 *   get:
 *     summary: Get maintenance task by ID
 *     tags: [Maintenance Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Maintenance task retrieved successfully
 *       404:
 *         description: Maintenance task not found
 */
router.get("/:id", protect, authorize("admin", "manager", "cleaner"), getMaintenanceTaskById);

/**
 * @swagger
 * /api/maintenance-tasks:
 *   post:
 *     summary: Create maintenance task
 *     tags: [Maintenance Tasks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Maintenance task created successfully
 */
router.post("/", protect, authorize("admin", "manager"), createMaintenanceTask);

/**
 * @swagger
 * /api/maintenance-tasks/{id}:
 *   put:
 *     summary: Update maintenance task
 *     tags: [Maintenance Tasks]
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
 *         description: Maintenance task updated successfully
 */
router.put("/:id", protect, authorize("admin", "manager"), updateMaintenanceTask);

/**
 * @swagger
 * /api/maintenance-tasks/{id}:
 *   delete:
 *     summary: Delete maintenance task
 *     tags: [Maintenance Tasks]
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
 *         description: Maintenance task deleted successfully
 */
router.delete("/:id", protect, authorize("admin"), deleteMaintenanceTask);

module.exports = router;
