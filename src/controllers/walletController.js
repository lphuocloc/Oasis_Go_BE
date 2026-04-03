const walletService = require("../services/walletService");

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
