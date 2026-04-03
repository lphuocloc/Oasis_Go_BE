const express = require('express');
const router = express.Router();
const vnpayController = require('../controllers/vnpayController');
const { protect } = require('../middlewares/authMiddleware');

/**
 * @swagger
 * /api/vnpay/create-payment:
 *   post:
 *     summary: Create VNPay payment URL for pending order
 *     description: Create a transaction record and generate a VNPay payment URL. Amount is automatically taken from BookingOrder.payable_total_price (rental + deposit) with fallback to final_total_price for old orders.
 *     tags: [VNPay Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingOrderId
 *               - orderInfo
 *             properties:
 *               bookingOrderId:
 *                 type: string
 *                 description: BookingOrder ID (used as VNPay orderId)
 *                 example: "b157661c-c9c1-4da5-9baf-4ec859f4f1ba"
 *               orderInfo:
 *                 type: string
 *                 description: Order description / payment info
 *                 example: "Thanh toan dat phong Ocean View pod"
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
 *                   example: "Payment URL created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                     orderId:
 *                       type: string
 *                       example: "b157661c-c9c1-4da5-9baf-4ec859f4f1ba"
 *                       description: "Same as bookingOrderId"
 *                     amount:
 *                       type: number
 *                       description: "Amount from BookingOrder.payable_total_price (rental + deposit)"
 *                       example: 250000
 *                     status:
 *                       type: string
 *                       example: "PENDING"
 *                     paymentUrl:
 *                       type: string
 *                       example: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=25000000&..."
 *       400:
 *         description: Bad request - missing required fields or invalid order status
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
 *                   example: "Missing required fields: bookingOrderId, orderInfo"
 *       404:
 *         description: Booking order not found
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
 *                   example: "Error creating payment"
 */
router.post('/create-payment', vnpayController.createPayment);

/**
 * @swagger
 * /api/vnpay/wallet-topup/create-payment:
 *   post:
 *     summary: Create VNPay payment URL for wallet topup
 *     description: Create a pending TOPUP transaction and return VNPay payment URL for wallet topup.
 *     tags: [VNPay Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 1000
 *                 description: Topup amount in VND
 *                 example: 100000
 *               orderInfo:
 *                 type: string
 *                 description: Topup description
 *                 example: "Nap tien vao vi OASISGO"
 *     responses:
 *       200:
 *         description: Wallet topup payment URL created successfully
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
 *                   example: Payment URL created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId:
 *                       type: string
 *                       example: 550e8400-e29b-41d4-a716-446655440000
 *                     amount:
 *                       type: number
 *                       example: 100000
 *                     status:
 *                       type: string
 *                       example: PENDING
 *                     paymentUrl:
 *                       type: string
 *                       example: https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=10000000&...
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/wallet-topup/create-payment', protect, vnpayController.createWalletTopupPayment);

/**
 * @route   GET /api/vnpay/wallet-topup/return
 * @desc    Wallet topup VNPay return endpoint after payment
 * @access  Public
 */
router.get('/wallet-topup/return', vnpayController.walletTopupReturn);

/**
 * @route   GET /api/vnpay/wallet-topup/ipn
 * @desc    Wallet topup VNPay IPN callback
 * @access  Public
 */
router.get('/wallet-topup/ipn', vnpayController.walletTopupIpn);

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
