const bcrypt = require("bcryptjs");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");

const PIN_REGEX = /^\d{6}$/;
const OTP_EXPIRES_MINUTES = 10;

class WalletService {
    assertPinFormat(pin, fieldName = "PIN") {
        const pinString = String(pin || "").trim();
        if (!PIN_REGEX.test(pinString)) {
            const error = new Error(`${fieldName} must be exactly 6 digits`);
            error.statusCode = 400;
            throw error;
        }
        return pinString;
    }

    async getOrCreateWalletByUserId(userId) {
        let wallet = await Wallet.findOne({ user_id: userId });
        if (!wallet) {
            wallet = await Wallet.create({ user_id: userId, balance: 0, status: "ACTIVE" });
        }
        return wallet;
    }

    ensureWalletActive(wallet) {
        if (wallet.status !== "ACTIVE") {
            const error = new Error("Wallet is locked");
            error.statusCode = 423;
            throw error;
        }
    }

    toWalletResponse(wallet) {
        return {
            id: wallet.id,
            user_id: wallet.user_id,
            balance: wallet.balance,
            status: wallet.status,
            has_pincode: Boolean(wallet.pincode_hash),
            updated_at: wallet.updated_at,
        };
    }

    async getMyWallet(userId) {
        const wallet = await this.getOrCreateWalletByUserId(userId);
        return this.toWalletResponse(wallet);
    }

    async getMyWalletTransactions(userId, query = {}) {
        const wallet = await this.getOrCreateWalletByUserId(userId);

        const page = Math.max(parseInt(query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);

        const filter = { wallet_id: wallet.id };

        if (query.type) {
            const normalizedType = String(query.type).toUpperCase();
            const allowedTypes = ["TOPUP", "PAYMENT", "REFUND"];

            if (!allowedTypes.includes(normalizedType)) {
                const error = new Error("Invalid transaction type. Allowed values: TOPUP, PAYMENT, REFUND");
                error.statusCode = 400;
                throw error;
            }

            filter.type = normalizedType;
        }

        if (query.startDate || query.endDate) {
            filter.created_at = {};

            if (query.startDate) {
                const startDate = new Date(query.startDate);
                if (Number.isNaN(startDate.getTime())) {
                    const error = new Error("Invalid startDate");
                    error.statusCode = 400;
                    throw error;
                }
                filter.created_at.$gte = startDate;
            }

            if (query.endDate) {
                const endDate = new Date(query.endDate);
                if (Number.isNaN(endDate.getTime())) {
                    const error = new Error("Invalid endDate");
                    error.statusCode = 400;
                    throw error;
                }
                filter.created_at.$lte = endDate;
            }
        }

        const total = await WalletTransaction.countDocuments(filter);
        const transactions = await WalletTransaction.find(filter)
            .sort({ created_at: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        return {
            wallet: this.toWalletResponse(wallet),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            data: transactions,
        };
    }

    async createPin(userId, { new_pin, confirm_pin }) {
        const nextPin = this.assertPinFormat(new_pin, "new_pin");
        const confirmPin = this.assertPinFormat(confirm_pin, "confirm_pin");

        if (nextPin !== confirmPin) {
            const error = new Error("PIN confirmation does not match");
            error.statusCode = 400;
            throw error;
        }

        const wallet = await this.getOrCreateWalletByUserId(userId);
        this.ensureWalletActive(wallet);

        if (wallet.pincode_hash) {
            const error = new Error("PIN already exists. Please use change PIN API");
            error.statusCode = 409;
            throw error;
        }

        wallet.pincode_hash = await bcrypt.hash(nextPin, 10);
        await wallet.save();

        return {
            message: "Wallet PIN created successfully",
            wallet: this.toWalletResponse(wallet),
        };
    }

    async changePin(userId, { current_pin, new_pin, confirm_pin }) {
        const currentPin = this.assertPinFormat(current_pin, "current_pin");
        const nextPin = this.assertPinFormat(new_pin, "new_pin");
        const confirmPin = this.assertPinFormat(confirm_pin, "confirm_pin");

        if (nextPin !== confirmPin) {
            const error = new Error("PIN confirmation does not match");
            error.statusCode = 400;
            throw error;
        }

        const wallet = await this.getOrCreateWalletByUserId(userId);
        this.ensureWalletActive(wallet);

        if (!wallet.pincode_hash) {
            const error = new Error("Wallet PIN has not been created");
            error.statusCode = 400;
            throw error;
        }

        const isCurrentPinMatch = await bcrypt.compare(currentPin, wallet.pincode_hash);
        if (!isCurrentPinMatch) {
            const error = new Error("Current PIN is incorrect");
            error.statusCode = 400;
            throw error;
        }

        if (currentPin === nextPin) {
            const error = new Error("New PIN must be different from current PIN");
            error.statusCode = 400;
            throw error;
        }

        wallet.pincode_hash = await bcrypt.hash(nextPin, 10);
        await wallet.save();

        return {
            message: "Wallet PIN changed successfully",
            wallet: this.toWalletResponse(wallet),
        };
    }

    async requestForgotPinOtp(userId) {
        const wallet = await this.getOrCreateWalletByUserId(userId);
        this.ensureWalletActive(wallet);

        if (!wallet.pincode_hash) {
            const error = new Error("Wallet PIN has not been created");
            error.statusCode = 400;
            throw error;
        }

        const user = await User.findById(userId).select("email");
        if (!user || !user.email) {
            const error = new Error("User email not found");
            error.statusCode = 400;
            throw error;
        }

        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

        await User.findByIdAndUpdate(userId, {
            resetPasswordOtp: otp,
            resetPasswordOtpExpires: otpExpires,
        });

        await sendOTPEmail(user.email, otp);

        return {
            message: "OTP has been sent to your email",
            email: user.email,
            expires_in_minutes: OTP_EXPIRES_MINUTES,
        };
    }

    async resetPin(userId, { otp, new_pin, confirm_pin }) {
        if (!otp) {
            const error = new Error("OTP is required");
            error.statusCode = 400;
            throw error;
        }

        const nextPin = this.assertPinFormat(new_pin, "new_pin");
        const confirmPin = this.assertPinFormat(confirm_pin, "confirm_pin");

        if (nextPin !== confirmPin) {
            const error = new Error("PIN confirmation does not match");
            error.statusCode = 400;
            throw error;
        }

        const user = await User.findById(userId).select("resetPasswordOtp resetPasswordOtpExpires");
        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 400;
            throw error;
        }

        const isExpired = !user.resetPasswordOtpExpires || new Date() > user.resetPasswordOtpExpires;
        if (!user.resetPasswordOtp || user.resetPasswordOtp !== otp || isExpired) {
            const error = new Error("OTP is invalid or expired");
            error.statusCode = 400;
            throw error;
        }

        const wallet = await this.getOrCreateWalletByUserId(userId);
        this.ensureWalletActive(wallet);

        wallet.pincode_hash = await bcrypt.hash(nextPin, 10);
        await wallet.save();

        user.resetPasswordOtp = null;
        user.resetPasswordOtpExpires = null;
        await user.save();

        return {
            message: "Wallet PIN reset successfully",
            wallet: this.toWalletResponse(wallet),
        };
    }
}

module.exports = new WalletService();
