const express = require("express");
const router = express.Router();
const podClusterController = require("../../controllers/admin/podClusterController");
const { protect, authorize } = require("../../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod Clusters
 *   description: Pod cluster management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PodCluster:
 *       type: object
 *       required:
 *         - location_id
 *         - name
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier (UUID)
 *           example: 550e8400-e29b-41d4-a716-446655440000
 *         location_id:
 *           type: string
 *           description: Reference to Location ID
 *           example: L01
 *         name:
 *           type: string
 *           description: Pod cluster name
 *           example: Cluster A - Premium Zone
 *         description:
 *           type: string
 *           description: Pod cluster description
 *           example: High-end pod cluster with premium amenities
 *         base_price_modifier:
 *           type: number
 *           format: float
 *           description: Base price modifier/multiplier
 *           example: 1.5
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/pod-clusters:
 *   get:
 *     summary: Get all pod clusters
 *     tags: [Pod Clusters]
 *     parameters:
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *         description: Filter by location ID
 *     responses:
 *       200:
 *         description: List of pod clusters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PodCluster'
 *       500:
 *         description: Server error
 */
router.get("/", podClusterController.getAllPodClusters);

/**
 * @swagger
 * /api/pod-clusters/location/{locationId}:
 *   get:
 *     summary: Get pod clusters by location
 *     tags: [Pod Clusters]
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Location ID
 *     responses:
 *       200:
 *         description: List of pod clusters for the location
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PodCluster'
 *       500:
 *         description: Server error
 */
router.get("/location/:locationId", podClusterController.getPodClustersByLocation);

/**
 * @swagger
 * /api/pod-clusters/{id}:
 *   get:
 *     summary: Get pod cluster by ID
 *     tags: [Pod Clusters]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *     responses:
 *       200:
 *         description: Pod cluster details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PodCluster'
 *       404:
 *         description: Pod cluster not found
 *       500:
 *         description: Server error
 */
router.get("/:id", podClusterController.getPodClusterById);

/**
 * @swagger
 * /api/pod-clusters:
 *   post:
 *     summary: Create a new pod cluster
 *     tags: [Pod Clusters]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - location_id
 *               - name
 *             properties:
 *               location_id:
 *                 type: string
 *                 example: L01
 *               name:
 *                 type: string
 *                 example: Cluster A - Premium Zone
 *               description:
 *                 type: string
 *                 example: High-end pod cluster with premium amenities
 *               base_price_modifier:
 *                 type: number
 *                 example: 1.5
 *     responses:
 *       201:
 *         description: Pod cluster created successfully
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
 *                   $ref: '#/components/schemas/PodCluster'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.post("/", protect, authorize("admin", "manager"), podClusterController.createPodCluster);

/**
 * @swagger
 * /api/pod-clusters/{id}:
 *   put:
 *     summary: Update a pod cluster
 *     tags: [Pod Clusters]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               location_id:
 *                 type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               base_price_modifier:
 *                 type: number
 *     responses:
 *       200:
 *         description: Pod cluster updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pod cluster or location not found
 *       500:
 *         description: Server error
 */
router.put("/:id", protect, authorize("admin", "manager"), podClusterController.updatePodCluster);

/**
 * @swagger
 * /api/pod-clusters/{id}:
 *   delete:
 *     summary: Delete a pod cluster
 *     tags: [Pod Clusters]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *     responses:
 *       200:
 *         description: Pod cluster deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pod cluster not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", protect, authorize("admin", "manager"), podClusterController.deletePodCluster);

module.exports = router;
