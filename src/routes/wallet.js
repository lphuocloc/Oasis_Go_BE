const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet and PIN management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Wallet:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 3f8058d7-f6cf-4bc0-9763-c4ebd9b7ce44
 *         user_id:
 *           type: string
 *           example: 7c0ee390-6070-43b3-a16f-79f010f37d8c
 *         balance:
 *           type: number
 *           example: 120000
 *         status:
 *           type: string
 *           enum: [ACTIVE, LOCKED]
 *           example: ACTIVE
 *         has_pin:
 *           type: boolean
 *           example: true
 *         updated_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

router.use(protect);

// Wallet info
/**
 * @swagger
 * /api/wallets/me:
 *   get:
 *     summary: Get current user's wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet retrieved successfully
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
 *                   example: Wallet retrieved successfully
 *                 data:
 *                   $ref: '#/components/schemas/Wallet'
 */
router.get("/me", walletController.getMyWallet);

/**
 * @swagger
 * /api/wallets/getWalletTransaction/me:
 *   get:
 *     summary: Get current user's wallet transactions
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [TOPUP, PAYMENT, REFUND, WITHDRAWAL_HOLD, WITHDRAWAL_SUCCESS, WITHDRAWAL_REFUND]
 *         description: Filter by transaction type
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
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from datetime
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter up to datetime
 *     responses:
 *       200:
 *         description: Wallet transactions fetched successfully
 *       400:
 *         description: Invalid query params
 *       401:
 *         description: Unauthorized
 */
router.get("/getWalletTransaction/me", walletController.getMyWalletTransactions);



// PIN lifecycle
/**
 * @swagger
 * /api/wallets/pin/create:
 *   post:
 *     summary: Create wallet PIN for first time
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [new_pin, confirm_pin]
 *             properties:
 *               new_pin:
 *                 type: string
 *                 example: "123456"
 *               confirm_pin:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: PIN created successfully
 *       400:
 *         description: Invalid input or PIN already exists
 */
router.post("/pin/create", walletController.createPin);

/**
 * @swagger
 * /api/wallets/pin/change:
 *   post:
 *     summary: Change wallet PIN
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_pin, new_pin, confirm_pin]
 *             properties:
 *               current_pin:
 *                 type: string
 *                 example: "123456"
 *               new_pin:
 *                 type: string
 *                 example: "654321"
 *               confirm_pin:
 *                 type: string
 *                 example: "654321"
 *     responses:
 *       200:
 *         description: PIN changed successfully
 *       400:
 *         description: Invalid input or wrong current PIN
 */
router.post("/pin/change", walletController.changePin);

/**
 * @swagger
 * /api/wallets/pin/forgot/request:
 *   post:
 *     summary: Request OTP to reset wallet PIN
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Wallet is locked or cannot send OTP
 */
router.post("/pin/forgot/request", walletController.requestForgotPinOtp);

/**
 * @swagger
 * /api/wallets/pin/forgot/reset:
 *   post:
 *     summary: Reset wallet PIN by OTP
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp, new_pin, confirm_pin]
 *             properties:
 *               otp:
 *                 type: string
 *                 example: "123456"
 *               new_pin:
 *                 type: string
 *                 example: "111222"
 *               confirm_pin:
 *                 type: string
 *                 example: "111222"
 *     responses:
 *       200:
 *         description: PIN reset successfully
 *       400:
 *         description: Invalid OTP or invalid PIN input
 */
router.post("/pin/forgot/reset", walletController.resetPin);

/**
 * @swagger
 * /api/wallets/pay-order:
 *   post:
 *     summary: Pay booking order by wallet (supports hybrid with VNPay)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingOrderId, pin]
 *             properties:
 *               bookingOrderId:
 *                 type: string
 *                 example: b157661c-c9c1-4da5-9baf-4ec859f4f1ba
 *               pin:
 *                 type: string
 *                 example: "123456"
 *               orderInfo:
 *                 type: string
 *                 example: Thanh toan don booking bang vi
 *     responses:
 *       200:
 *         description: Wallet payment processed
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [completed, pending_vnpay]
 *                     orderId:
 *                       type: string
 *                     orderTotalAmount:
 *                       type: number
 *                       description: Total payable amount of the order
 *                       example: 850000
 *                     paidAmountWallet:
 *                       type: number
 *                       description: Amount paid from wallet
 *                       example: 300000
 *                     remainingAmount:
 *                       type: number
 *                       description: Remaining amount to be paid
 *                       example: 550000
 *                     paymentUrl:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: Invalid request, wrong PIN or invalid order status
 *       403:
 *         description: Order does not belong to current user
 *       404:
 *         description: Booking order not found
 *       423:
 *         description: Wallet is locked
 */
router.post("/pay-order", walletController.payOrderByWallet);

/**
 * @swagger
 * /api/wallets/withdrawals/request:
 *   post:
 *     summary: Create withdrawal request (PIN required)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, pin]
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 150000
 *               pin:
 *                 type: string
 *                 example: "123456"
 *               note:
 *                 type: string
 *                 example: Rut tien ve tai khoan ngan hang
 *     responses:
 *       201:
 *         description: Withdrawal request created successfully
 *       400:
 *         description: Invalid amount, wrong PIN, missing bank info or insufficient balance
 */
router.post("/withdrawals/request", walletController.requestWithdrawal);

/**
 * @swagger
 * /api/wallets/withdrawals/me:
 *   get:
 *     summary: Get my withdrawal requests
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED]
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
 *     responses:
 *       200:
 *         description: Withdrawal requests fetched successfully
 */
router.get("/withdrawals/me", walletController.getMyWithdrawalRequests);

/**
 * @swagger
 * /api/wallets/withdrawals/{requestId}/cancel:
 *   post:
 *     summary: Cancel my pending withdrawal request
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal request cancelled successfully
 *       400:
 *         description: Request is not pending
 */
router.post("/withdrawals/:requestId/cancel", walletController.cancelMyWithdrawalRequest);

/**
 * @swagger
 * /api/wallets/withdrawals/pending:
 *   get:
 *     summary: Get withdrawal requests for admin (default ALL)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED, ALL]
 *         description: Filter by withdrawal status, default is ALL
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by requester user id
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Withdrawal requests fetched successfully
 *       403:
 *         description: Forbidden
 */
router.get("/withdrawals/pending", authorize("admin"), walletController.getPendingWithdrawalRequests);

/**
 * @swagger
 * /api/wallets/withdrawals/{requestId}/process:
 *   post:
 *     summary: Process withdrawal request (admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT, CANCEL]
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal request processed successfully
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Withdrawal request not found
 */
router.post("/withdrawals/:requestId/process", authorize("admin"), walletController.processWithdrawalRequest);

module.exports = router;
