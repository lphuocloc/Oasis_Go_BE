const express = require("express");
const router = express.Router();
const podDeviceController = require("../controllers/podDeviceController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod Devices
 *   description: Pod device management endpoints
 */

/**
 * @swagger
 * /api/pod-devices/by-cluster/{clusterId}:
 *   get:
 *     summary: Get all pod devices by pod cluster ID
 *     tags: [Pod Devices]
 *     parameters:
 *       - in: path
 *         name: clusterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *         example: 5f7a1f0b9f1b2c0017a7a001
 *       - in: query
 *         name: is_online
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Filter by online status
 *     responses:
 *       200:
 *         description: Pod devices fetched successfully
 *       400:
 *         description: Invalid request (missing clusterId)
 *       404:
 *         description: Pod cluster not found
 *       500:
 *         description: Server error
 */

router
  .route("/by-cluster/:clusterId")
  .get(podDeviceController.getDevicesByPodCluster);

/**
 * @swagger
 * /api/pod-devices/generate-by-cluster/{clusterId}:
 *   post:
 *     summary: Generate pod devices for all pods in a cluster
 *     tags: [Pod Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clusterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pod cluster ID
 *         example: 5f7a1f0b9f1b2c0017a7a001
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_name_prefix:
 *                 type: string
 *                 description: Prefix for generated device names
 *                 example: Pod Device
 *               device_id_prefix:
 *                 type: string
 *                 description: Prefix for generated device IDs
 *                 example: PODDEV
 *     responses:
 *       201:
 *         description: Pod devices generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Pod devices generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     cluster_id:
 *                       type: string
 *                     cluster_name:
 *                       type: string
 *                     total_pods:
 *                       type: integer
 *                     existing_devices:
 *                       type: integer
 *                     created_count:
 *                       type: integer
 *                     skipped_count:
 *                       type: integer
 *                     created_devices:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           pod_id:
 *                             type: string
 *                           device_name:
 *                             type: string
 *                           device_id:
 *                             type: string
 *                           is_online:
 *                             type: boolean
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     skipped:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           pod_id:
 *                             type: string
 *                           pod_code:
 *                             type: string
 *                           reason:
 *                             type: string
 *       400:
 *         description: Invalid request (missing clusterId)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin or manager only)
 *       404:
 *         description: Pod cluster not found or no pods in cluster
 *       500:
 *         description: Server error
 */

router
  .route("/generate-by-cluster/:clusterId")
  .post(protect, authorize("admin", "manager"), podDeviceController.generateDevicesByPodCluster);

 * components:
 *   schemas:
 *     PodDevice:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 7cd4469d-55d4-4ba1-ae8f-47aa6f1d6f14
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         device_name:
 *           type: string
 *           example: ESP32 Controller
 *         device_id:
 *           type: string
 *           example: esp32-001
 *         auth_token:
 *           type: string
 *           nullable: true
 *           example: secret-token
 *         is_online:
 *           type: boolean
 *           example: false
 *         last_ping:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PodDeviceInput:
 *       type: object
 *       required:
 *         - pod_id
 *         - device_name
 *         - device_id
 *       properties:
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         device_name:
 *           type: string
 *           example: ESP32 Controller
 *         device_id:
 *           type: string
 *           example: esp32-001
 *         auth_token:
 *           type: string
 *           nullable: true
 *           example: secret-token
 *         is_online:
 *           type: boolean
 *           example: true
 *         last_ping:
 *           type: string
 *           format: date-time
 *           nullable: true
 */

/**
 * @swagger
 * /api/pod-devices:
 *   get:
 *     summary: Get all pod devices
 *     tags: [Pod Devices]
 *     responses:
 *       200:
 *         description: Pod devices retrieved successfully
 */

/**
 * @swagger
 * /api/pod-devices:
 *   post:
 *     summary: Create pod device
 *     tags: [Pod Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PodDeviceInput'
 *     responses:
 *       201:
 *         description: Pod device created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/")
  .get(podDeviceController.getAllDevices)
  .post(protect, authorize("admin", "manager", "user"), podDeviceController.createDevice);

/**
 * @swagger
 * /api/pod-devices/{id}:
 *   get:
 *     summary: Get pod device by ID
 *     tags: [Pod Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pod device retrieved successfully
 *       404:
 *         description: Pod device not found
 */

/**
 * @swagger
 * /api/pod-devices/{id}:
 *   put:
 *     summary: Update pod device by ID
 *     tags: [Pod Devices]
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
 *             $ref: '#/components/schemas/PodDeviceInput'
 *     responses:
 *       200:
 *         description: Pod device updated successfully
 *       404:
 *         description: Pod device not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/pod-devices/{id}:
 *   delete:
 *     summary: Delete pod device by ID
 *     tags: [Pod Devices]
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
 *         description: Pod device deleted successfully
 *       404:
 *         description: Pod device not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/:id")
  .get(podDeviceController.getDeviceById)
  .put(protect, authorize("admin", "manager"), podDeviceController.updateDevice)
  .delete(protect, authorize("admin", "manager"), podDeviceController.deleteDevice);

module.exports = router;
