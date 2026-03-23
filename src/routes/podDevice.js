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
