const express = require("express");
const router = express.Router();
const podItemController = require("../controllers/podItemController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod Items
 *   description: Manage expected and current item quantities in pods
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PodItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 4af4cb45-a21e-4c6b-8c64-8f851f707ec8
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         item_id:
 *           type: string
 *           example: item_001
 *         expected_quantity:
 *           type: number
 *           minimum: 0
 *           example: 20
 *         current_quantity:
 *           type: number
 *           minimum: 0
 *           example: 12
 *         updated_at:
 *           type: string
 *           format: date-time
 *     PodItemInput:
 *       type: object
 *       required:
 *         - pod_id
 *         - item_id
 *       properties:
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         item_id:
 *           type: string
 *           example: item_001
 *         expected_quantity:
 *           type: number
 *           minimum: 0
 *           example: 20
 *         current_quantity:
 *           type: number
 *           minimum: 0
 *           example: 15
 */

/**
 * @swagger
 * /api/pod-items:
 *   get:
 *     summary: Get all pod items
 *     tags: [Pod Items]
 *     responses:
 *       200:
 *         description: Pod items retrieved successfully
 */

/**
 * @swagger
 * /api/pod-items:
 *   post:
 *     summary: Create pod item
 *     tags: [Pod Items]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PodItemInput'
 *     responses:
 *       201:
 *         description: Pod item created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/")
  .get(podItemController.getAllPodItems)
  .post(protect, authorize("admin", "manager"), podItemController.createPodItem);

/**
 * @swagger
 * /api/pod-items/{id}:
 *   get:
 *     summary: Get pod item by ID
 *     tags: [Pod Items]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pod item retrieved successfully
 *       404:
 *         description: Pod item not found
 */

/**
 * @swagger
 * /api/pod-items/{id}:
 *   put:
 *     summary: Update pod item by ID
 *     tags: [Pod Items]
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
 *             $ref: '#/components/schemas/PodItemInput'
 *     responses:
 *       200:
 *         description: Pod item updated successfully
 *       404:
 *         description: Pod item not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/pod-items/{id}:
 *   delete:
 *     summary: Delete pod item by ID
 *     tags: [Pod Items]
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
 *         description: Pod item deleted successfully
 *       404:
 *         description: Pod item not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/:id")
  .get(podItemController.getPodItemById)
  .put(protect, authorize("admin", "manager"), podItemController.updatePodItem)
  .delete(protect, authorize("admin", "manager"), podItemController.deletePodItem);

module.exports = router;
