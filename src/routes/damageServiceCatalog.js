const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createDamageServiceCatalog,
  getAllDamageServiceCatalogs,
  getDamageServiceCatalogById,
  updateDamageServiceCatalog,
  deleteDamageServiceCatalog,
} = require("../controllers/damageServiceCatalogController");

/**
 * @swagger
 * tags:
 *   name: DamageServiceCatalogs
 *   description: Manage damage service catalogs for incident service lines
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     DamageServiceCatalog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: b4ecf6af-e63f-4da8-bf88-67f2a1b0c219
 *         name:
 *           type: string
 *           example: Khu mui thuoc la
 *         category:
 *           type: string
 *           enum: [CONSTRUCTION, CLEANING, PENALTY]
 *           nullable: true
 *         base_price:
 *           type: number
 *           minimum: 0
 *           example: 200000
 *         unit_name:
 *           type: string
 *           nullable: true
 *           example: lan
 *         description:
 *           type: string
 *           nullable: true
 *         is_active:
 *           type: boolean
 *           example: true
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     DamageServiceCatalogInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: Phi gian doan kinh doanh
 *         category:
 *           type: string
 *           enum: [CONSTRUCTION, CLEANING, PENALTY]
 *           nullable: true
 *         base_price:
 *           type: number
 *           minimum: 0
 *           example: 500000
 *         unit_name:
 *           type: string
 *           nullable: true
 *           example: gio
 *         description:
 *           type: string
 *           nullable: true
 *         is_active:
 *           type: boolean
 */

/**
 * @swagger
 * /api/damage-service-catalogs:
 *   get:
 *     summary: Get all damage service catalogs
 *     tags: [DamageServiceCatalogs]
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [CONSTRUCTION, CLEANING, PENALTY]
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Damage service catalogs retrieved successfully
 */
router.get("/", getAllDamageServiceCatalogs);

/**
 * @swagger
 * /api/damage-service-catalogs/{id}:
 *   get:
 *     summary: Get damage service catalog by id
 *     tags: [DamageServiceCatalogs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Damage service catalog retrieved successfully
 *       404:
 *         description: Damage service catalog not found
 */
router.get("/:id", getDamageServiceCatalogById);

/**
 * @swagger
 * /api/damage-service-catalogs:
 *   post:
 *     summary: Create damage service catalog
 *     tags: [DamageServiceCatalogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DamageServiceCatalogInput'
 *     responses:
 *       201:
 *         description: Damage service catalog created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Duplicate name
 */
router.post("/", protect, authorize("admin", "manager"), createDamageServiceCatalog);

/**
 * @swagger
 * /api/damage-service-catalogs/{id}:
 *   put:
 *     summary: Update damage service catalog
 *     tags: [DamageServiceCatalogs]
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
 *             $ref: '#/components/schemas/DamageServiceCatalogInput'
 *     responses:
 *       200:
 *         description: Damage service catalog updated successfully
 *       404:
 *         description: Damage service catalog not found
 */
router.put("/:id", protect, authorize("admin", "manager"), updateDamageServiceCatalog);

/**
 * @swagger
 * /api/damage-service-catalogs/{id}:
 *   delete:
 *     summary: Delete damage service catalog
 *     tags: [DamageServiceCatalogs]
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
 *         description: Damage service catalog deleted successfully
 *       404:
 *         description: Damage service catalog not found
 *       409:
 *         description: Catalog is in use by incident details
 */
router.delete("/:id", protect, authorize("admin"), deleteDamageServiceCatalog);

module.exports = router;
