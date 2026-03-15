const express = require("express");
const router = express.Router();
const bookingOrderController = require("../controllers/bookingOrderController");
const { protect } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: BookingOrders
 *   description: Booking order management endpoints
 */

/**
 * @swagger
 * /api/booking-orders:
 *   post:
 *     summary: Create a new booking order
 *     tags: [BookingOrders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cluster_id
 *               - start_time
 *               - end_time
 *             properties:
 *               cluster_id:
 *                 type: string
 *                 description: Pod cluster ID
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Booking start time
 *                 example: "2026-03-05T12:00:00Z"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 description: Booking end time
 *                 example: "2026-03-05T14:00:00Z"
 *               pod_count:
 *                 type: integer
 *                 description: Number of pods to book
 *                 default: 1
 *                 minimum: 1
 *               total_discount:
 *                 type: number
 *                 description: Total discount amount (optional)
 *                 default: 0
 *                 minimum: 0
 *               require_adjacent:
 *                 type: boolean
 *                 description: Require adjacent pods if booking multiple
 *                 default: false
 *               floor_preference:
 *                 type: string
 *                 enum: [U, L]
 *                 description: Preference for upper (U) or lower (L) floor
 *               accept_fragmented:
 *                 type: boolean
 *                 description: Accept booking even if pods are fragmented across the cluster
 *                 default: false
 *               accept_mixed_floor:
 *                 type: boolean
 *                 description: Accept booking even if pods have to be allocated on different floors
 *                 default: false
 *     responses:
 *       201:
 *         description: Booking order created successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: User or cluster not found
 *       409:
 *         description: Not enough available pods or confirmation required (CONFIRMATION_REQUIRED_MIXED_FLOOR, CONFIRMATION_REQUIRED_FRAGMENTED, OUT_OF_STOCK)
 *     security:
 *       - bearerAuth: []
 */
router.post("/", protect, bookingOrderController.createBookingOrder);

/**
 * @swagger
 * /api/booking-orders:
 *   get:
 *     summary: Get all booking orders with filters
 *     tags: [BookingOrders]
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID, PARTIALLY_CANCELLED, CANCELLED]
 *         description: Filter by status
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by created date (start)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by created date (end)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of booking orders
 *     security:
 *       - bearerAuth: []
 */
router.get("/", protect, bookingOrderController.getAllBookingOrders);

/**
 * @swagger
 * /api/booking-orders/{id}:
 *   get:
 *     summary: Get booking order by ID
 *     tags: [BookingOrders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking order ID
 *     responses:
 *       200:
 *         description: Booking order details
 *       404:
 *         description: Booking order not found
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id", protect, bookingOrderController.getBookingOrderById);

/**
 * @swagger
 * /api/booking-orders/{id}/cancel:
 *   put:
 *     summary: Cancel booking order
 *     tags: [BookingOrders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking order ID
 *     responses:
 *       200:
 *         description: Booking order cancelled successfully
 *       400:
 *         description: Cannot cancel order
 *       404:
 *         description: Booking order not found
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id/cancel", protect, bookingOrderController.cancelBookingOrder);

/**
 * @swagger
 * /api/booking-orders/{id}/mark-paid:
 *   put:
 *     summary: Mark order as paid
 *     tags: [BookingOrders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking order ID
 *     responses:
 *       200:
 *         description: Order marked as paid successfully
 *       400:
 *         description: Cannot mark order as paid
 *       404:
 *         description: Booking order not found
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id/mark-paid", protect, bookingOrderController.markOrderAsPaid);

module.exports = router;
