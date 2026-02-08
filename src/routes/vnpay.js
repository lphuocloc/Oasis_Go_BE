const express = require('express');
const router = express.Router();
const vnpayController = require('../controllers/vnpayController');

/**
 * @swagger
 * /api/vnpay/create-payment:
 *   post:
 *     summary: Tạo URL thanh toán VNPay
 *     description: Tạo payment record trong database và generate VNPay payment URL. OrderId sẽ tự động generate theo format ORDER-YYYYMMDD-XXX
 *     tags: [VNPay Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - orderInfo
 *             properties:
 *               bookingId:
 *                 type: string
 *                 description: ID đơn đặt phòng (optional, sẽ auto-generate nếu không có)
 *                 example: "BOOKING-2026-001"
 *               amount:
 *                 type: number
 *                 description: Số tiền thanh toán (VND)
 *                 example: 250000
 *               orderInfo:
 *                 type: string
 *                 description: Thông tin mô tả đơn hàng
 *                 example: "Thanh toan dat phong Ocean View"
 *     responses:
 *       200:
 *         description: Tạo payment URL thành công
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
 *                     paymentId:
 *                       type: string
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                     bookingId:
 *                       type: string
 *                       example: "BOOKING-2026-001"
 *                     orderId:
 *                       type: string
 *                       example: "ORDER-20260208-001"
 *                       description: "Auto-generated theo format ORDER-YYYYMMDD-XXX"
 *                     amount:
 *                       type: number
 *                       example: 250000
 *                     status:
 *                       type: string
 *                       example: "INITIATED"
 *                     paymentUrl:
 *                       type: string
 *                       example: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=25000000&..."
 *       400:
 *         description: Bad request - Missing required fields hoặc invalid data
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
 *                   example: "Missing required fields: orderId, amount, orderInfo"
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
 * @desc    VNPay redirect người dùng về sau khi thanh toán
 * @access  Public
 * @query   VNPay params (vnp_*)
 */
router.get('/return', vnpayController.vnpayReturn);

/**
 * @route   GET /api/vnpay/ipn
 * @desc    VNPay IPN callback (Instant Payment Notification)
 * @access  Public (VNPay gọi vào)
 * @query   VNPay params (vnp_*)
 * 
 * QUAN TRỌNG: Endpoint này phải public, VNPay sẽ gọi vào để notify
 */
router.get('/ipn', vnpayController.vnpayIpn);

/**
 * @route   POST /api/vnpay/query-status
 * @desc    Query trạng thái giao dịch từ VNPay (Not implemented)
 * @access  Protected
 */
router.post('/query-status', vnpayController.queryPaymentStatus);

/**
 * @route   POST /api/vnpay/refund
 * @desc    Hoàn tiền giao dịch (Not implemented)
 * @access  Protected
 */
router.post('/refund', vnpayController.refundPayment);

/**
 * @swagger
 * /api/vnpay/payment/{orderId}:
 *   get:
 *     summary: Lấy thông tin payment theo orderId
 *     description: Query chi tiết payment từ database theo order ID
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID của payment cần query
 *         example: "ORDER-2026-001"
 *     responses:
 *       200:
 *         description: Payment found successfully
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
 *                   example: "Payment found"
 *                 data:
 *                   $ref: '#/components/schemas/Payment'
 *       404:
 *         description: Payment not found
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
 *                   example: "Payment not found"
 *       500:
 *         description: Internal server error
 */
router.get('/payment/:orderId', vnpayController.getPaymentByOrderId);

/**
 * @swagger
 * /api/vnpay/payments/booking/{bookingId}:
 *   get:
 *     summary: Lấy tất cả payments của một booking
 *     description: Query tất cả payment records liên quan đến một booking ID
 *     tags: [VNPay Payment]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID cần query payments
 *         example: "BOOKING-2026-001"
 *     responses:
 *       200:
 *         description: Payments found successfully
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
 *                   example: "Payments found"
 *                 count:
 *                   type: number
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Payment'
 *       500:
 *         description: Internal server error
 */
router.get('/payments/booking/:bookingId', vnpayController.getPaymentsByBookingId);

module.exports = router;
