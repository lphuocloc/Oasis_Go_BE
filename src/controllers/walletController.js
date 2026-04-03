const walletService = require("../services/walletService");
const paymentService = require("../services/paymentService");

exports.getMyWallet = async (req, res) => {
    try {
        const result = await walletService.getMyWallet(req.user.id);
        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching wallet",
        });
    }
};

exports.getMyWalletTransactions = async (req, res) => {
    try {
        const result = await walletService.getMyWalletTransactions(req.user.id, req.query);
        res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination,
            wallet: result.wallet,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching wallet transactions",
        });
    }
};

exports.createPin = async (req, res) => {
    try {
        const result = await walletService.createPin(req.user.id, req.body);
        res.status(201).json({
            success: true,
            message: result.message,
            data: result.wallet,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error creating wallet PIN",
        });
    }
};

exports.changePin = async (req, res) => {
    try {
        const result = await walletService.changePin(req.user.id, req.body);
        res.status(200).json({
            success: true,
            message: result.message,
            data: result.wallet,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error changing wallet PIN",
        });
    }
};

exports.requestForgotPinOtp = async (req, res) => {
    try {
        const result = await walletService.requestForgotPinOtp(req.user.id);
        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                email: result.email,
                expires_in_minutes: result.expires_in_minutes,
            },
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error requesting forgot PIN OTP",
        });
    }
};

exports.resetPin = async (req, res) => {
    try {
        const result = await walletService.resetPin(req.user.id, req.body);
        res.status(200).json({
            success: true,
            message: result.message,
            data: result.wallet,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error resetting wallet PIN with OTP",
        });
    }
};

exports.payOrderByWallet = async (req, res) => {
    try {
        const { bookingOrderId, pin, orderInfo } = req.body || {};

        if (!bookingOrderId || !pin) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: bookingOrderId, pin",
            });
        }

        const userId = req.user && (req.user._id || req.user.id);
        const ipAddr =
            req.headers["x-forwarded-for"] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress ||
            "127.0.0.1";

        const result = await paymentService.payOrderByWallet({
            bookingOrderId,
            userId,
            pin,
            orderInfo,
            ipAddr,
        });

        return res.status(200).json({
            success: true,
            message:
                result.mode === "completed"
                    ? "Order paid successfully by wallet"
                    : "Wallet payment recorded, remaining amount pending via VNPay",
            data: result,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error paying order by wallet",
        });
    }
};
