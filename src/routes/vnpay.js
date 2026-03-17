const express = require('express');
const router = express.Router();
const vnpayController = require('../controllers/vnpayController');
const { protect } = require('../middlewares/authMiddleware');

/**
 * @swagger
 * /api/vnpay/create-payment:
 *   post:
 *     summary: Create VNPay payment URL
 *     description: Create a transaction record and generate a VNPay payment URL. The orderId is taken directly from bookingOrderId.
 *     tags: [VNPay Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingOrderId
 *               - amount
 *               - orderInfo
 *             properties:
 *               bookingOrderId:
 *                 type: string
 *                 description: BookingOrder ID (used as VNPay orderId)
 *                 example: "b157661c-c9c1-4da5-9baf-4ec859f4f1ba"
 *               amount:
 *                 type: number
 *                 description: Payment amount (VND)
 *                 example: 250000
 *               orderInfo:
 *                 type: string
 *                 description: Order description
 *                 example: "Thanh toan dat phong Ocean View"
 *     responses:
 *       200:
 *         description: Payment URL created successfully
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
 *                   example: "Create payment URL successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                     orderId:
 *                       type: string
 *                       example: "b157661c-c9c1-4da5-9baf-4ec859f4f1ba"
 *                       description: "Same value as bookingOrderId"
 *                     amount:
 *                       type: number
 *                       example: 250000
 *                     status:
 *                       type: string
 *                       example: "PENDING"
 *                     paymentUrl:
 *                       type: string
 *                       example: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=25000000&..."
 *       400:
 *         description: Bad request - missing required fields or invalid data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Missing required fields: bookingOrderId, amount, orderInfo"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Internal server error"
 */
router.post('/create-payment', vnpayController.createPayment);

/**
 * @route   GET /api/vnpay/return
 * @desc    VNPay user redirect endpoint after payment
 * @access  Public
 * @query   VNPay params (vnp_*)
 */
router.get('/return', vnpayController.vnpayReturn);

/**
 * @route   GET /api/vnpay/ipn
 * @desc    VNPay IPN callback (Instant Payment Notification)
 * @access  Public (called by VNPay)
 * @query   VNPay params (vnp_*)
 * 
 * IMPORTANT: This endpoint must be public because VNPay calls it directly.
 */
router.get('/ipn', vnpayController.vnpayIpn);

/**
 * @route   POST /api/vnpay/query-status
 * @desc    Query transaction status from VNPay (Not implemented)
 * @access  Protected
 */
router.post('/query-status', vnpayController.queryPaymentStatus);

/**
 * @route   POST /api/vnpay/refund
 * @desc    Refund transaction (Not implemented)
 * @access  Protected
 */
router.post('/refund', vnpayController.refundPayment);

/**
 * @swagger
 * /api/vnpay/transactions:
 *   get:
 *     summary: Get all transactions
 *     description: Retrieve all transactions with filters and pagination
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *         description: Filter by payment method
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by transaction type (CHARGE, REFUND, PENALTY)
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *         description: Filter by BookingOrder ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from this datetime
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter up to this datetime
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transactions fetched successfully
 */
router.get('/transactions', protect, vnpayController.getAllTransactions);

/**
 * @swagger
 * /api/vnpay/my-transactions:
 *   get:
 *     summary: Get current user's transactions
 *     description: No request body is required. User ID is extracted from the JWT token.
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Current page number
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Number of records per page
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transactions fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 2
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                     total:
 *                       type: integer
 *                       example: 24
 *                     totalPages:
 *                       type: integer
 *                       example: 3
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 *       401:
 *         description: Unauthorized
 */
router.get('/my-transactions', protect, vnpayController.getMyTransactions);

/**
 * @swagger
 * /api/vnpay/payment/{orderId}:
 *   get:
 *     summary: Get transaction by orderId
 *     description: Retrieve transaction details from database by order ID
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction order ID to query
 *         example: "ORDER-2026-001"
 *     responses:
 *       200:
 *         description: Transaction found successfully
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
 *                   example: "Transaction found"
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Transaction not found"
 *       500:
 *         description: Internal server error
 */
router.get('/payment/:orderId', vnpayController.getPaymentByOrderId);

/**
 * @swagger
 * /api/vnpay/payments/booking/{bookingId}:
 *   get:
 *     summary: Get transactions by orderId
 *     description: Retrieve all transaction records by order ID (bookingOrderId)
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: BookingOrder ID used to query transactions
 *         example: "b157661c-c9c1-4da5-9baf-4ec859f4f1ba"
 *     responses:
 *       200:
 *         description: Transactions found successfully
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
 *                   example: "Transactions found"
 *                 count:
 *                   type: number
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 *       500:
 *         description: Internal server error
 */
router.get('/payments/booking/:bookingId', vnpayController.getPaymentsByBookingId);

module.exports = router;
