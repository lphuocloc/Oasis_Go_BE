const express = require("express");
const router = express.Router();
const podDeviceController = require("../controllers/podDeviceController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod Devices
 *   description: Manage IoT devices attached to pods
 */

/**
 * @swagger
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
  .post(protect, authorize("admin", "manager"), podDeviceController.createDevice);

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
