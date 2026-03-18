const express = require("express");
const router = express.Router();
const podAmenityController = require("../controllers/podAmenityController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Pod Amenities
 *   description: Manage amenities configured for each pod
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PodAmenity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 7b2268ec-1ac1-4d77-aac9-43fe7af1ce04
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         name:
 *           type: string
 *           example: Air Conditioner
 *         value:
 *           type: string
 *           nullable: true
 *           example: Available
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PodAmenityInput:
 *       type: object
 *       required:
 *         - pod_id
 *         - name
 *       properties:
 *         pod_id:
 *           type: string
 *           example: pod_001
 *         name:
 *           type: string
 *           example: TV
 *         value:
 *           type: string
 *           nullable: true
 *           example: 43-inch
 */

/**
 * @swagger
 * /api/pod-amenities:
 *   get:
 *     summary: Get all pod amenities
 *     tags: [Pod Amenities]
 *     responses:
 *       200:
 *         description: Pod amenities retrieved successfully
 */

/**
 * @swagger
 * /api/pod-amenities:
 *   post:
 *     summary: Create pod amenity
 *     tags: [Pod Amenities]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PodAmenityInput'
 *     responses:
 *       201:
 *         description: Pod amenity created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/")
  .get(podAmenityController.getAllAmenities)
  .post(protect, authorize("admin", "manager"), podAmenityController.createAmenity);

/**
 * @swagger
 * /api/pod-amenities/{id}:
 *   get:
 *     summary: Get pod amenity by ID
 *     tags: [Pod Amenities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pod amenity retrieved successfully
 *       404:
 *         description: Pod amenity not found
 */

/**
 * @swagger
 * /api/pod-amenities/{id}:
 *   put:
 *     summary: Update pod amenity by ID
 *     tags: [Pod Amenities]
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
 *             $ref: '#/components/schemas/PodAmenityInput'
 *     responses:
 *       200:
 *         description: Pod amenity updated successfully
 *       404:
 *         description: Pod amenity not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/pod-amenities/{id}:
 *   delete:
 *     summary: Delete pod amenity by ID
 *     tags: [Pod Amenities]
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
 *         description: Pod amenity deleted successfully
 *       404:
 *         description: Pod amenity not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

router
  .route("/:id")
  .get(podAmenityController.getAmenityById)
  .put(protect, authorize("admin", "manager"), podAmenityController.updateAmenity)
  .delete(protect, authorize("admin", "manager"), podAmenityController.deleteAmenity);

module.exports = router;
