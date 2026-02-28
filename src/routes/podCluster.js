const express = require("express");
const router = express.Router();
const podClusterController = require("../controllers/podClusterController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { uploadPodClusterImage } = require("../config/cloudinary");

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
 * /api/pod-clusters/{id}/images:
 *   get:
 *     summary: Get all images of a pod cluster
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
 *         description: List of pod cluster images
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       cluster_id:
 *                         type: string
 *                       image_url:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *       404:
 *         description: Pod cluster not found
 *       500:
 *         description: Server error
 */
router.get("/:id/images", podClusterController.getPodClusterImages);

/**
 * @swagger
 * /api/pod-clusters/{id}/images/{imageId}:
 *   delete:
 *     summary: Delete a specific image of a pod cluster
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
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Image ID to delete
 *     responses:
 *       200:
 *         description: Image deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pod cluster or image not found
 *       500:
 *         description: Server error
 */
router.delete("/:id/images/:imageId", protect, authorize("admin", "manager"), podClusterController.deletePodClusterImage);

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
 *         multipart/form-data:
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
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Pod cluster images (max 10 files, 5MB each)
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
router.post("/", protect, authorize("admin", "manager"), uploadPodClusterImage.array("images", 10), podClusterController.createPodCluster);

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
 *         multipart/form-data:
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
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Additional images to add (max 10 files, 5MB each)
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
router.put("/:id", protect, authorize("admin", "manager"), uploadPodClusterImage.array("images", 10), podClusterController.updatePodCluster);

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
