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

router.use(protect);

// Wallet info
router.get("/me", walletController.getMyWallet);

// PIN lifecycle
router.post("/pin/create", walletController.createPin);
router.post("/pin/change", walletController.changePin);
router.post("/pin/forgot/request", walletController.requestForgotPinOtp);
router.post("/pin/forgot/reset", walletController.resetPin);

module.exports = router;
