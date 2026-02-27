const express = require("express");
const router = express.Router();
const podController = require("../controllers/podController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pods
 *   description: Pod management endpoints (Grid and Single creation modes)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Pod:
 *       type: object
 *       required:
 *         - cluster_id
 *         - code
 *         - name
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier (UUID)
 *         cluster_id:
 *           type: string
 *           description: Reference to Pod Cluster ID
 *         code:
 *           type: string
 *           description: Unique pod code (e.g., A01L, B05U)
 *         name:
 *           type: string
 *           description: Pod name
 *         description:
 *           type: string
 *           description: Pod description
 *         status:
 *           type: string
 *           enum: [AVAILABLE, OCCUPIED, NEEDS_CLEANING, CLEANING, MAINTENANCE]
 *           default: AVAILABLE
 *         maintenance_status:
 *           type: string
 *           description: Maintenance status description
 *         soundproof_level:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           default: 3
 *         ventilation_level:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           default: 3
 *         power_outlets:
 *           type: integer
 *           minimum: 0
 *           default: 2
 *         wifi_available:
 *           type: boolean
 *           default: true
 *         max_session_duration:
 *           type: integer
 *           description: Maximum session duration in minutes
 *           default: 480
 *         last_cleaned_at:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/pods/create:
 *   post:
 *     summary: Create pods (Grid or Single mode)
 *     tags: [Pods]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 title: Grid Mode
 *                 required:
 *                   - cluster_id
 *                   - numRows
 *                   - numCols
 *                 properties:
 *                   cluster_id:
 *                     type: string
 *                     example: cluster-uuid-123
 *                   numRows:
 *                     type: integer
 *                     description: Number of rows (A, B, C, ...) - Max 10
 *                     minimum: 1
 *                     maximum: 10
 *                     example: 3
 *                   numCols:
 *                     type: integer
 *                     description: Number of columns (01, 02, 03, ...) - Max 20
 *                     minimum: 1
 *                     maximum: 20
 *                     example: 5
 *                   name:
 *                     type: string
 *                     description: Optional base name for pods
 *                     example: Premium Pod
 *                   description:
 *                     type: string
 *                   soundproof_level:
 *                     type: integer
 *                     minimum: 1
 *                     maximum: 5
 *                   ventilation_level:
 *                     type: integer
 *                     minimum: 1
 *                     maximum: 5
 *                   power_outlets:
 *                     type: integer
 *                     minimum: 0
 *                   wifi_available:
 *                     type: boolean
 *                   max_session_duration:
 *                     type: integer
 *               - type: object
 *                 title: Single Mode
 *                 required:
 *                   - cluster_id
 *                   - code
 *                   - name
 *                 properties:
 *                   cluster_id:
 *                     type: string
 *                     example: cluster-uuid-123
 *                   code:
 *                     type: string
 *                     example: X99L
 *                   name:
 *                     type: string
 *                     example: VIP Pod X99L
 *                   description:
 *                     type: string
 *                   soundproof_level:
 *                     type: integer
 *                   ventilation_level:
 *                     type: integer
 *                   power_outlets:
 *                     type: integer
 *                   wifi_available:
 *                     type: boolean
 *                   max_session_duration:
 *                     type: integer
 *     responses:
 *       201:
 *         description: Pods created successfully
 *       400:
 *         description: Invalid input or exceeded limits (Max rows 10, Max cols 20, Max total pods 200)
 *       404:
 *         description: Pod cluster not found
 *       409:
 *         description: Duplicate pod codes
 *       500:
 *         description: Server error
 */
router.post("/create", protect, authorize("admin"), podController.createPods);

/**
 * @swagger
 * /api/pods:
 *   get:
 *     summary: Get all pods
 *     tags: [Pods]
 *     parameters:
 *       - in: query
 *         name: cluster_id
 *         schema:
 *           type: string
 *         description: Filter by cluster ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [AVAILABLE, OCCUPIED, NEEDS_CLEANING, CLEANING, MAINTENANCE]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of pods
 *       500:
 *         description: Server error
 */
router.get("/", podController.getAllPods);

/**
 * @swagger
 * /api/pods/available:
 *   get:
 *     summary: Get available pods
 *     tags: [Pods]
 *     parameters:
 *       - in: query
 *         name: cluster_id
 *         schema:
 *           type: string
 *         description: Filter by cluster ID
 *     responses:
 *       200:
 *         description: List of available pods
 *       500:
 *         description: Server error
 */
router.get("/available", podController.getAvailablePods);

/**
 * @swagger
 * /api/pods/cluster/{clusterId}:
 *   get:
 *     summary: Get pods by cluster
 *     tags: [Pods]
 *     parameters:
 *       - in: path
 *         name: clusterId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of pods in the cluster
 *       500:
 *         description: Server error
 */
router.get("/cluster/:clusterId", podController.getPodsByCluster);

/**
 * @swagger
 * /api/pods/{id}:
 *   get:
 *     summary: Get pod by ID
 *     tags: [Pods]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pod details
 *       404:
 *         description: Pod not found
 *       500:
 *         description: Server error
 */
router.get("/:id", podController.getPodById);

/**
 * @swagger
 * /api/pods/{id}:
 *   put:
 *     summary: Update pod
 *     tags: [Pods]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, OCCUPIED, NEEDS_CLEANING, CLEANING, MAINTENANCE]
 *               maintenance_status:
 *                 type: string
 *               soundproof_level:
 *                 type: integer
 *               ventilation_level:
 *                 type: integer
 *               power_outlets:
 *                 type: integer
 *               wifi_available:
 *                 type: boolean
 *               max_session_duration:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Pod updated successfully
 *       404:
 *         description: Pod not found
 *       500:
 *         description: Server error
 */
router.put("/:id", protect, authorize("admin", "manager"), podController.updatePod);

/**
 * @swagger
 * /api/pods/{id}/status:
 *   patch:
 *     summary: Update pod status
 *     tags: [Pods]
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [AVAILABLE, OCCUPIED, NEEDS_CLEANING, CLEANING, MAINTENANCE]
 *               maintenance_status:
 *                 type: string
 *                 description: Required when status is MAINTENANCE
 *     responses:
 *       200:
 *         description: Pod status updated successfully
 *       400:
 *         description: Invalid status transition
 *       404:
 *         description: Pod not found
 *       500:
 *         description: Server error
 */
router.patch("/:id/status", protect, authorize("admin", "manager", "cleaner"), podController.updatePodStatus);

/**
 * @swagger
 * /api/pods/{id}/complete-cleaning:
 *   patch:
 *     summary: Complete pod cleaning
 *     tags: [Pods]
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
 *         description: Cleaning completed successfully
 *       400:
 *         description: Pod is not in CLEANING status
 *       404:
 *         description: Pod not found
 */
router.patch("/:id/complete-cleaning", protect, authorize("admin", "manager", "cleaner"), podController.completePodCleaning);

/**
 * @swagger
 * /api/pods/{id}:
 *   delete:
 *     summary: Delete pod
 *     tags: [Pods]
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
 *         description: Pod deleted successfully
 *       400:
 *         description: Cannot delete occupied pod
 *       404:
 *         description: Pod not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", protect, authorize("admin"), podController.deletePod);

module.exports = router;
