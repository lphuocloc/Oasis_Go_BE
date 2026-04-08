const express = require("express");
const router = express.Router();
const bookingOrderController = require("../controllers/bookingOrderController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
	loadManagerScope,
	applyManagerPodScope,
} = require("../middlewares/managerScopeMiddleware");

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
 *                 description: Manual discount amount (optional, ignored when voucher_code is provided)
 *                 default: 0
 *                 minimum: 0
 *               voucher_code:
 *                 type: string
 *                 description: Optional voucher code to apply during order creation
 *                 example: NEWUSER20
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
 *           enum: [PENDING, PAID, PARTIAL_CANCEL, FULLY_CANCELLED, CANCEL]
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
router.get(
	"/",
	protect,
	loadManagerScope,
	applyManagerPodScope,
	bookingOrderController.getAllBookingOrders
);

/**
 * @swagger
 * /api/booking-orders/refunds/pending:
 *   get:
 *     summary: Get pending refund requests in manager scope
 *     tags: [BookingOrders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: order_id
 *         schema:
 *           type: string
 *         description: Filter by booking order ID (must be in manager scope)
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
 *         description: Pending refund requests retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     refunds:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           order_id:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           currency:
 *                             type: string
 *                           type:
 *                             type: string
 *                             example: REFUND
 *                           status:
 *                             type: string
 *                             example: PENDING
 *                           provider_reference:
 *                             type: string
 *                             nullable: true
 *                           created_at:
 *                             type: string
 *                             format: date-time
 *                           order:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               id:
 *                                 type: string
 *                               user_id:
 *                                 type: string
 *                               status:
 *                                 type: string
 *                               final_total_price:
 *                                 type: number
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       403:
 *         description: Forbidden (Only manager can access)
 */
router.get(
	"/refunds/pending",
	protect,
	authorize("manager"),
	loadManagerScope,
	applyManagerPodScope,
	bookingOrderController.getPendingRefundRequests
);

/**
 * @swagger
 * /api/booking-orders/refunds/{refundId}/process:
 *   post:
 *     summary: Process a pending refund request (manager only)
 *     tags: [BookingOrders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: refundId
 *         required: true
 *         schema:
 *           type: string
 *         description: Refund transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT]
 *                 description: Approve or reject this refund request
 *               note:
 *                 type: string
 *                 description: Optional manager note for audit trail
 *     responses:
 *       200:
 *         description: Refund request processed successfully
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
 *                   example: Refund request processed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     decision:
 *                       type: string
 *                       enum: [APPROVE, REJECT]
 *                     refund:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         order_id:
 *                           type: string
 *                         amount:
 *                           type: number
 *                         type:
 *                           type: string
 *                           example: REFUND
 *                         status:
 *                           type: string
 *                           description: SUCCESS when APPROVE, VOIDED when REJECT
 *                         provider_reference:
 *                           type: string
 *       400:
 *         description: Invalid action or refund already processed
 *       403:
 *         description: Forbidden (Manager has no access to this refund)
 *       404:
 *         description: Refund request not found
 */
router.post(
	"/refunds/:refundId/process",
	protect,
	authorize("manager"),
	loadManagerScope,
	bookingOrderController.processRefundRequest
);

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
router.get("/:id", protect, loadManagerScope, bookingOrderController.getBookingOrderById);

/**
 * @swagger
 * /api/booking-orders/{id}/cancel:
 *   put:
 *     summary: Cancel booking order
 *     tags: [BookingOrders]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               booking_id:
 *                 type: string
 *                 description: Cancel one booking inside a PAID order
 *               booking_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Cancel multiple bookings inside a PAID/PARTIAL_CANCEL order
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
 * /api/booking-orders/{id}/checkout:
 *   post:
 *     summary: Checkout bookings in an order (all or selected)
 *     tags: [BookingOrders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking order ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scope:
 *                 type: string
 *                 enum: [ALL_IN_ORDER, SELECTED_BOOKINGS]
 *                 default: ALL_IN_ORDER
 *               booking_id:
 *                 type: string
 *                 description: Single booking ID when checkout one room in SELECTED_BOOKINGS mode
 *               booking_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Multiple booking IDs in SELECTED_BOOKINGS mode
 *     responses:
 *       200:
 *         description: Checkout processed with summary
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Not order owner
 *       404:
 *         description: Booking order not found
 */
router.post("/:id/checkout", protect, bookingOrderController.checkoutBookingOrder);

/**
 * @swagger
 * /api/booking-orders/{id}/repay:
 *   post:
 *     summary: Initiate repayment for PENDING order
 *     tags: [BookingOrders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking order ID
 *     responses:
 *       201:
 *         description: Repayment link created successfully
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
 *                   example: "Repayment link created (Attempt #2)"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                     orderId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     attemptNumber:
 *                       type: integer
 *                     paymentUrl:
 *                       type: string
 *                     orderExpireAt:
 *                       type: string
 *                       format: date-time
 *                     paymentExpireAt:
 *                       type: string
 *                       format: date-time
 *                     remainingSeconds:
 *                       type: integer
 *       400:
 *         description: Bad request (Order not PENDING or too close to expiration)
 *       403:
 *         description: Forbidden (Not order owner)
 *       404:
 *         description: Order not found
 *       410:
 *         description: Gone (Order expired)
 */
router.post("/:id/repay", protect, bookingOrderController.initiateRepayment);

module.exports = router;
