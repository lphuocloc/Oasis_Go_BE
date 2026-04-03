const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { protect } = require("../middlewares/authMiddleware");

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
 *           enum: [TOPUP, PAYMENT, REFUND]
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
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
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

module.exports = router;
