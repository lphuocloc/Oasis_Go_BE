const express = require("express");
const router = express.Router();
const doorController = require("../controllers/doorController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Doors
 *   description: Manage pod door states and metadata
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Door:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: f031f49f-f2e2-4dbf-9f99-c3f0e2132a66
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         lock_status:
 *           type: string
 *           enum: [LOCKED, UNLOCKED]
 *           example: LOCKED
 *         door_sensor:
 *           type: string
 *           enum: [CLOSED, OPEN]
 *           example: CLOSED
 *         last_sync_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     DoorInput:
 *       type: object
 *       required:
 *         - pod_id
 *       properties:
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         lock_status:
 *           type: string
 *           enum: [LOCKED, UNLOCKED]
 *           example: UNLOCKED
 *         door_sensor:
 *           type: string
 *           enum: [CLOSED, OPEN]
 *           example: OPEN
 *         last_sync_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 */

/**
 * @swagger
 * /api/doors:
 *   get:
 *     summary: Get all doors
 *     tags: [Doors]
 *     responses:
 *       200:
 *         description: Doors retrieved successfully
 */

/**
 * @swagger
 * /api/doors:
 *   post:
 *     summary: Create a door
 *     tags: [Doors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DoorInput'
 *     responses:
 *       201:
 *         description: Door created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/")
  .get(doorController.getAllDoors)
  .post(protect, authorize("admin", "manager"), doorController.createDoor);

/**
 * @swagger
 * /api/doors/{id}:
 *   get:
 *     summary: Get door by ID
 *     tags: [Doors]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Door retrieved successfully
 *       404:
 *         description: Door not found
 */

/**
 * @swagger
 * /api/doors/{id}:
 *   put:
 *     summary: Update door by ID
 *     tags: [Doors]
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
 *             $ref: '#/components/schemas/DoorInput'
 *     responses:
 *       200:
 *         description: Door updated successfully
 *       404:
 *         description: Door not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/doors/{id}:
 *   delete:
 *     summary: Delete door by ID
 *     tags: [Doors]
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
 *         description: Door deleted successfully
 *       404:
 *         description: Door not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/:id")
  .get(doorController.getDoorById)
  .put(protect, authorize("admin", "manager"), doorController.updateDoor)
  .delete(protect, authorize("admin"), doorController.deleteDoor);

module.exports = router;
