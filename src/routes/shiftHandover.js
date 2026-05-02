const express = require("express");
const router = express.Router();
const shiftHandoverController = require("../controllers/shiftHandoverController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope } = require("../middlewares/managerScopeMiddleware");

/**
 * @swagger
 * tags:
 *   name: Shift Handovers
 *   description: Shift handover log management endpoints
 */

/**
 * @swagger
 * /api/shift-handovers:
 *   post:
 *     summary: Create a shift handover note
 *     description: Managers must create a handover note before checking out of their shift.
 *     tags: [Shift Handovers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - note_text
 *             properties:
 *               note_text:
 *                 type: string
 *                 description: Summary of the shift activities and notes for the next manager.
 *     responses:
 *       201:
 *         description: Handover note created successfully
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
 *                   type: object
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (only managers)
 *       404:
 *         description: No active roster found for manager
 */
router.post(
  "/",
  protect,
  authorize("manager"),
  shiftHandoverController.createHandover
);

/**
 * @swagger
 * /api/shift-handovers/recent:
 *   get:
 *     summary: Get recent shift handovers
 *     description: Retrieve recent handovers within the manager's scope.
 *     tags: [Shift Handovers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return (default 5)
 *     responses:
 *       200:
 *         description: Recent handovers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/recent",
  protect,
  loadManagerScope,
  shiftHandoverController.getRecentHandovers
);

module.exports = router;
