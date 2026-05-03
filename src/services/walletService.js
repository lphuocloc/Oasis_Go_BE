const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const User = require("../models/User");
const notificationService = require("./notificationService");
const adminLedgerService = require("./adminLedgerService");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");

const PIN_REGEX = /^\d{6}$/;
const OTP_EXPIRES_MINUTES = 10;

class WalletService {
    _parseDateOrThrow(value, fieldName) {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            const error = new Error(`Invalid ${fieldName}`);
            error.statusCode = 400;
            throw error;
        }
        return parsed;
    }

    assertPinFormat(pin, fieldName = "PIN") {
        const pinString = String(pin || "").trim();
        if (!PIN_REGEX.test(pinString)) {
            const error = new Error(`${fieldName} must be exactly 6 digits`);
            error.statusCode = 400;
            throw error;
        }
        return pinString;
    }

    async getOrCreateWalletByUserId(userId, session = null) {
        let walletQuery = Wallet.findOne({ user_id: userId });
        if (session) {
            walletQuery = walletQuery.session(session);
        }

        let wallet = await walletQuery;
        if (!wallet) {
            if (session) {
                const createdWallets = await Wallet.create([{ user_id: userId, balance: 0, status: "ACTIVE" }], { session });
                wallet = createdWallets[0];
            } else {
                wallet = await Wallet.create({ user_id: userId, balance: 0, status: "ACTIVE" });
            }
        }
        return wallet;
    }

    async verifyPaymentPin(userId, pin, session = null) {
        const normalizedPin = this.assertPinFormat(pin, "pin");
        const wallet = await this.getOrCreateWalletByUserId(userId, session);

        this.ensureWalletActive(wallet);

        if (!wallet.pincode_hash) {
            const error = new Error("Wallet PIN has not been created");
            error.statusCode = 400;
            throw error;
        }

        const isPinMatch = await bcrypt.compare(normalizedPin, wallet.pincode_hash);
        if (!isPinMatch) {
            const error = new Error("Wallet PIN is incorrect");
            error.statusCode = 400;
            throw error;
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
            const allowedTypes = ["TOPUP", "PAYMENT", "REFUND", "WITHDRAWAL_HOLD", "WITHDRAWAL_SUCCESS", "WITHDRAWAL_REFUND"];

            if (!allowedTypes.includes(normalizedType)) {
                const error = new Error("Invalid transaction type. Allowed values: TOPUP, PAYMENT, REFUND, WITHDRAWAL_HOLD, WITHDRAWAL_SUCCESS, WITHDRAWAL_REFUND");
                error.statusCode = 400;
                throw error;
            }

            filter.type = normalizedType;
        }

        const effectiveStartDate = query.startDate || null;
        const effectiveEndDate = query.endDate || null;

        if (effectiveStartDate || effectiveEndDate) {
            filter.created_at = {};

            if (effectiveStartDate) {
                filter.created_at.$gte = this._parseDateOrThrow(effectiveStartDate, "startDate");
            }

            if (effectiveEndDate) {
                filter.created_at.$lte = this._parseDateOrThrow(effectiveEndDate, "endDate");
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

    _normalizeAmount(amount) {
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            const error = new Error("amount must be a positive number");
            error.statusCode = 400;
            throw error;
        }

        return Number(parsed.toFixed(2));
    }

    _normalizeOptionalNote(note) {
        if (note === undefined || note === null) {
            return null;
        }

        const normalizedNote = String(note).trim();
        if (!normalizedNote) {
            return null;
        }

        return normalizedNote.slice(0, 300);
    }

    toWithdrawalRequestResponse(withdrawalRequest) {
        return {
            id: withdrawalRequest.id,
            user_id: withdrawalRequest.user_id,
            wallet_id: withdrawalRequest.wallet_id,
            amount: withdrawalRequest.amount,
            status: withdrawalRequest.status,
            bank_name_snapshot: withdrawalRequest.bank_name_snapshot,
            bank_account_number_snapshot: withdrawalRequest.bank_account_number_snapshot,
            note: withdrawalRequest.note,
            requested_at: withdrawalRequest.requested_at,
            processed_at: withdrawalRequest.processed_at,
            processed_by: withdrawalRequest.processed_by,
            updated_at: withdrawalRequest.updated_at,
        };
    }

    async notifyAdminsOnWithdrawalRequest({ requester, withdrawalRequest }) {
        try {
            if (!withdrawalRequest?.id) {
                console.warn("[WithdrawNotifyAdmin] Skip notify because withdrawalRequest.id is missing");
                return;
            }

            const adminUsers = await User.find({ role: "admin", isActive: true })
                .select("_id")
                .lean();

            if (!adminUsers.length) {
                console.info(`[WithdrawNotifyAdmin] No active admin found for request ${withdrawalRequest.id}`);
                return;
            }

            console.info(
                `[WithdrawNotifyAdmin] Preparing notifications for ${adminUsers.length} admin(s), request=${withdrawalRequest.id}, user=${withdrawalRequest.user_id}`,
            );

            const requesterName = String(requester?.name || "").trim() || "Unknown";
            const requesterEmail = String(requester?.email || "").trim() || "N/A";
            const requesterPhone = String(requester?.phone || "").trim() || "N/A";
            const amount = Number(withdrawalRequest.amount || 0);
            const amountLabel = amount.toLocaleString("vi-VN");

            const notifyTasks = adminUsers.map((admin) => {
                const adminId = String(admin._id || "").trim();
                if (!adminId) {
                    console.warn(`[WithdrawNotifyAdmin] Skip one admin record without _id for request ${withdrawalRequest.id}`);
                    return Promise.resolve({
                        adminId: null,
                        success: false,
                        error: "Admin _id is missing",
                    });
                }

                return notificationService
                    .sendToUser(adminId, {
                        title: "Yêu cầu rút tiền!",
                        message: `${requesterName} vừa tạo yêu cầu rút tiền ${amountLabel} VND. vui lòng kiểm tra và xử lý!`,
                        type: "PAYMENT",
                        event_code: "WITHDRAWAL_REQUEST_CREATED",
                        dedupe_key: `WITHDRAWAL_REQUEST_CREATED:${withdrawalRequest.id}:ADMIN:${adminId}`,
                        data: {
                            withdrawal_request_id: String(withdrawalRequest.id),
                            requester_user_id: String(withdrawalRequest.user_id || ""),
                            requester_name: requesterName,
                            requester_email: requesterEmail,
                            requester_phone: requesterPhone,
                            amount: String(withdrawalRequest.amount || 0),
                            status: String(withdrawalRequest.status || "PENDING"),
                            requested_at: withdrawalRequest.requested_at
                                ? new Date(withdrawalRequest.requested_at).toISOString()
                                : new Date().toISOString(),
                        },
                    })
                    .then((response) => ({
                        adminId,
                        success: Boolean(response?.success),
                        error: response?.error || null,
                    }))
                    .catch((sendError) => ({
                        adminId,
                        success: false,
                        error: sendError?.message || String(sendError),
                    }));
            });

            const notifyResults = await Promise.allSettled(notifyTasks);
            const successCount = notifyResults.filter((item) => {
                if (item.status !== "fulfilled") return false;
                if (!item.value) return false;
                return Boolean(item.value.success);
            }).length;
            const failedCount = notifyResults.length - successCount;

            const failedDetails = notifyResults
                .map((item) => {
                    if (item.status === "rejected") {
                        return {
                            adminId: null,
                            error: item.reason?.message || String(item.reason),
                        };
                    }

                    if (!item.value?.success) {
                        return {
                            adminId: item.value?.adminId || null,
                            error: item.value?.error || "Unknown error",
                        };
                    }

                    return null;
                })
                .filter(Boolean);

            console.info(
                `[WithdrawNotifyAdmin] Completed request=${withdrawalRequest.id}. success=${successCount}, failed=${failedCount}`,
            );
            if (failedDetails.length) {
                console.warn(
                    `[WithdrawNotifyAdmin] Failed details request=${withdrawalRequest.id}: ${JSON.stringify(failedDetails)}`,
                );
            }
        } catch (error) {
            console.error("notifyAdminsOnWithdrawalRequest Error:", error);
        }
    }

    emitWithdrawRequestSocketEventToUser({ userId, withdrawalRequest }) {
        try {
            const normalizedUserId = String(userId || "").trim();
            if (!normalizedUserId || !withdrawalRequest?.id) {
                return;
            }

            const socketServer = require("../socket/socketServer");
            if (!socketServer || typeof socketServer.emitUserNotificationEvent !== "function") {
                return;
            }

            socketServer.emitUserNotificationEvent({
                user_id: normalizedUserId,
                notification: {
                    title: "Yêu cầu rút tiền đã được tạo!",
                    message: `Yêu cầu rút tiền ${withdrawalRequest.id} đang chờ xử lý.`,
                    type: "PAYMENT",
                    event_code: "WITHDRAWAL_REQUEST_CREATED",
                    data: {
                        withdrawal_request_id: String(withdrawalRequest.id),
                        amount: String(withdrawalRequest.amount || 0),
                        status: String(withdrawalRequest.status || "PENDING"),
                        requested_at: withdrawalRequest.requested_at
                            ? new Date(withdrawalRequest.requested_at).toISOString()
                            : new Date().toISOString(),
                    },
                },
            });
        } catch (error) {
            console.error("emitWithdrawRequestSocketEventToUser Error:", error);
        }
    }

    async createWithdrawalRequest(userId, { amount, pin, note }) {
        if (!pin) {
            const error = new Error("pin is required");
            error.statusCode = 400;
            throw error;
        }

        const withdrawalAmount = this._normalizeAmount(amount);
        const normalizedNote = this._normalizeOptionalNote(note);

        const session = await mongoose.startSession();
        let createdRequest = null;
        let wallet = null;
        let requester = null;

        try {
            await session.withTransaction(async () => {
                requester = await User.findById(userId)
                    .select("name email phone bank_name bank_account_number debt_status debt_total_cached")
                    .session(session);

                if (!requester) {
                    const error = new Error("User not found");
                    error.statusCode = 404;
                    throw error;
                }

                const bankName = String(requester.bank_name || "").trim();
                const bankAccountNumber = String(requester.bank_account_number || "").trim();
                const debtStatus = String(requester.debt_status || "NONE").toUpperCase();
                const debtAmount = Number(requester.debt_total_cached || 0);

                if (debtStatus === "IN_DEBT" || debtStatus === "BLACKLISTED" || debtAmount > 0) {
                    const error = new Error("Withdrawal is locked while account has outstanding debt");
                    error.statusCode = 423;
                    throw error;
                }

                if (!bankName || !bankAccountNumber) {
                    const error = new Error("Please update bank_name and bank_account_number before requesting withdrawal");
                    error.statusCode = 400;
                    throw error;
                }

                wallet = await this.verifyPaymentPin(userId, pin, session);

                const balanceBefore = Number(wallet.balance || 0);
                if (balanceBefore < withdrawalAmount) {
                    const error = new Error("Insufficient wallet balance");
                    error.statusCode = 400;
                    throw error;
                }

                const balanceAfter = Number((balanceBefore - withdrawalAmount).toFixed(2));
                wallet.balance = balanceAfter;
                await wallet.save({ session });

                const createdRequests = await WithdrawalRequest.create([
                    {
                        user_id: String(userId),
                        wallet_id: wallet.id,
                        amount: withdrawalAmount,
                        status: "PENDING",
                        bank_name_snapshot: bankName,
                        bank_account_number_snapshot: bankAccountNumber,
                        note: normalizedNote,
                    },
                ], { session });

                createdRequest = createdRequests[0];

                const withdrawalHoldTransactions = await WalletTransaction.create([
                    {
                        wallet_id: wallet.id,
                        amount: withdrawalAmount,
                        type: "WITHDRAWAL_HOLD",
                        transaction_id: null,
                        reference_id: createdRequest.id,
                        description: `Hold withdrawal request ${createdRequest.id}`,
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                    },
                ], { session });

                await adminLedgerService.createEntry(
                    {
                        type: "ESCROW_DEBIT",
                        amount: withdrawalAmount,
                        source: "WITHDRAWAL_HOLD",
                        dedupe_key: `WITHDRAWAL_HOLD:${createdRequest.id}`,
                        user_id: String(userId),
                        wallet_id: wallet.id,
                        withdrawal_request_id: createdRequest.id,
                        wallet_transaction_id: withdrawalHoldTransactions[0]?.id || null,
                        reference_id: createdRequest.id,
                        description: `Withdrawal hold ${createdRequest.id}`,
                    },
                    session,
                );
            });
        } finally {
            session.endSession();
        }

        console.info(
            `[WithdrawRequest] Created request=${createdRequest?.id || "N/A"} for user=${userId}, amount=${createdRequest?.amount || 0}. Triggering admin notifications...`,
        );

        await this.notifyAdminsOnWithdrawalRequest({
            requester,
            withdrawalRequest: createdRequest,
        });

        this.emitWithdrawRequestSocketEventToUser({
            userId,
            withdrawalRequest: createdRequest,
        });

        return {
            request: this.toWithdrawalRequestResponse(createdRequest),
            wallet: this.toWalletResponse(wallet),
        };
    }

    async getMyWithdrawalRequests(userId, query = {}) {
        const page = Math.max(parseInt(query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
        const skip = (page - 1) * limit;

        const filter = { user_id: String(userId) };
        if (query.status) {
            const normalizedStatus = String(query.status || "").toUpperCase();
            const allowedStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
            if (!allowedStatuses.includes(normalizedStatus)) {
                const error = new Error("Invalid status. Allowed values: PENDING, APPROVED, REJECTED, CANCELLED");
                error.statusCode = 400;
                throw error;
            }
            filter.status = normalizedStatus;
        }

        const [rows, total] = await Promise.all([
            WithdrawalRequest.find(filter)
                .sort({ requested_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            WithdrawalRequest.countDocuments(filter),
        ]);

        return {
            data: rows.map((row) => this.toWithdrawalRequestResponse(row)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getPendingWithdrawalRequests(query = {}) {
        const page = Math.max(parseInt(query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
        const skip = (page - 1) * limit;

        const filter = {};

        const normalizedStatus = String(query.status || "ALL").trim().toUpperCase();
        const allowedStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"];
        if (!allowedStatuses.includes(normalizedStatus)) {
            const error = new Error("Invalid status. Allowed values: PENDING, APPROVED, REJECTED, CANCELLED, ALL");
            error.statusCode = 400;
            throw error;
        }

        if (normalizedStatus !== "ALL") {
            filter.status = normalizedStatus;
        }

        if (query.user_id) {
            filter.user_id = String(query.user_id).trim();
        }

        const [rows, total] = await Promise.all([
            WithdrawalRequest.find(filter)
                .sort({ requested_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            WithdrawalRequest.countDocuments(filter),
        ]);

        const requesterIds = [...new Set(
            rows
                .map((row) => String(row.user_id || "").trim())
                .filter(Boolean),
        )];

        let requesterNameMap = new Map();
        if (requesterIds.length) {
            const requesters = await User.find({ _id: { $in: requesterIds } })
                .select("_id name")
                .lean();

            requesterNameMap = new Map(
                requesters.map((requester) => [
                    String(requester._id),
                    String(requester.name || "").trim() || null,
                ]),
            );
        }

        return {
            data: rows.map((row) => ({
                ...this.toWithdrawalRequestResponse(row),
                requester_name: requesterNameMap.get(String(row.user_id)) || null,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async processWithdrawalRequest(requestId, actor, { action, note }) {
        const actorRole = String(actor?.role || "").toLowerCase();
        if (actorRole !== "admin") {
            const error = new Error("Only admin can process withdrawal requests");
            error.statusCode = 403;
            throw error;
        }

        const normalizedAction = String(action || "").toUpperCase();
        if (!["APPROVE", "REJECT", "CANCEL"].includes(normalizedAction)) {
            const error = new Error("action must be APPROVE, REJECT or CANCEL");
            error.statusCode = 400;
            throw error;
        }

        const normalizedRequestId = String(requestId || "").trim();
        if (!normalizedRequestId) {
            const error = new Error("requestId is required");
            error.statusCode = 400;
            throw error;
        }

        const normalizedNote = this._normalizeOptionalNote(note);
        const actorId = String(actor?._id || actor?.id || "").trim() || null;
        const now = new Date();

        const existingRequest = await WithdrawalRequest.findOne({ id: normalizedRequestId });
        if (!existingRequest) {
            const error = new Error("Withdrawal request not found");
            error.statusCode = 404;
            throw error;
        }

        if (existingRequest.status !== "PENDING") {
            const error = new Error(`Withdrawal request is already processed with status ${existingRequest.status}`);
            error.statusCode = 400;
            throw error;
        }

        const session = await mongoose.startSession();
        let updatedRequest = null;

        try {
            await session.withTransaction(async () => {
                const liveRequest = await WithdrawalRequest.findOne({ id: normalizedRequestId }).session(session);
                if (!liveRequest) {
                    const error = new Error("Withdrawal request not found");
                    error.statusCode = 404;
                    throw error;
                }

                if (liveRequest.status !== "PENDING") {
                    const error = new Error(`Withdrawal request is already processed with status ${liveRequest.status}`);
                    error.statusCode = 400;
                    throw error;
                }

                const holdWalletTransaction = await WalletTransaction.findOne({
                    wallet_id: liveRequest.wallet_id,
                    reference_id: liveRequest.id,
                    type: "WITHDRAWAL_HOLD",
                }).session(session);

                if (normalizedAction === "APPROVE") {
                    if (!holdWalletTransaction) {
                        const error = new Error("Withdrawal hold transaction not found");
                        error.statusCode = 409;
                        throw error;
                    }

                    holdWalletTransaction.type = "WITHDRAWAL_SUCCESS";
                    holdWalletTransaction.description = `Withdrawal approved ${liveRequest.id}`;
                    await holdWalletTransaction.save({ session });

                    liveRequest.status = "APPROVED";
                    liveRequest.processed_at = now;
                    liveRequest.processed_by = actorId;
                    liveRequest.note = normalizedNote;
                    await liveRequest.save({ session });

                    await adminLedgerService.createEntry(
                        {
                            type: "PAYOUT",
                            amount: Number(liveRequest.amount || 0),
                            escrow_delta: 0,
                            source: "WITHDRAWAL_PAYOUT",
                            dedupe_key: `WITHDRAWAL_PAYOUT:${liveRequest.id}`,
                            user_id: String(liveRequest.user_id || ""),
                            wallet_id: liveRequest.wallet_id || null,
                            withdrawal_request_id: liveRequest.id,
                            reference_id: liveRequest.id,
                            description: `Withdrawal payout ${liveRequest.id}`,
                        },
                        session,
                    );

                    updatedRequest = liveRequest;
                    return;
                }

                const wallet = await this.getOrCreateWalletByUserId(liveRequest.user_id, session);
                const balanceBefore = Number(wallet.balance || 0);
                const balanceAfter = Number((balanceBefore + Number(liveRequest.amount || 0)).toFixed(2));

                wallet.balance = balanceAfter;
                await wallet.save({ session });

                if (holdWalletTransaction) {
                    holdWalletTransaction.type = "WITHDRAWAL_REFUND";
                    holdWalletTransaction.description = normalizedAction === "REJECT"
                        ? `Refund rejected withdrawal ${liveRequest.id}`
                        : `Refund cancelled withdrawal ${liveRequest.id}`;
                    holdWalletTransaction.balance_before = balanceBefore;
                    holdWalletTransaction.balance_after = balanceAfter;
                    await holdWalletTransaction.save({ session });
                } else {
                    // Backward-safe fallback for legacy data that has no HOLD record.
                    await WalletTransaction.create([
                        {
                            wallet_id: wallet.id,
                            amount: Number(liveRequest.amount || 0),
                            type: "WITHDRAWAL_REFUND",
                            transaction_id: null,
                            reference_id: liveRequest.id,
                            description: normalizedAction === "REJECT"
                                ? `Refund rejected withdrawal ${liveRequest.id}`
                                : `Refund cancelled withdrawal ${liveRequest.id}`,
                            balance_before: balanceBefore,
                            balance_after: balanceAfter,
                        },
                    ], { session });
                }

                await adminLedgerService.createEntry(
                    {
                        type: "ESCROW_CREDIT",
                        amount: Number(liveRequest.amount || 0),
                        source: "WITHDRAWAL_REFUND",
                        dedupe_key: `WITHDRAWAL_REFUND:${liveRequest.id}`,
                        user_id: String(liveRequest.user_id || ""),
                        wallet_id: wallet.id,
                        withdrawal_request_id: liveRequest.id,
                        reference_id: liveRequest.id,
                        description: normalizedAction === "REJECT"
                            ? `Withdrawal refund (rejected) ${liveRequest.id}`
                            : `Withdrawal refund (cancelled) ${liveRequest.id}`,
                    },
                    session,
                );

                liveRequest.status = normalizedAction === "REJECT" ? "REJECTED" : "CANCELLED";
                liveRequest.processed_at = now;
                liveRequest.processed_by = actorId;
                liveRequest.note = normalizedNote;
                await liveRequest.save({ session });

                updatedRequest = liveRequest;
            });
        } finally {
            session.endSession();
        }

        return {
            decision: normalizedAction,
            request: this.toWithdrawalRequestResponse(updatedRequest),
        };
    }

    async cancelMyWithdrawalRequest(userId, requestId, { note } = {}) {
        const normalizedRequestId = String(requestId || "").trim();
        if (!normalizedRequestId) {
            const error = new Error("requestId is required");
            error.statusCode = 400;
            throw error;
        }

        const ownerId = String(userId || "").trim();
        const normalizedNote = this._normalizeOptionalNote(note);
        const now = new Date();

        const existingRequest = await WithdrawalRequest.findOne({ id: normalizedRequestId });
        if (!existingRequest) {
            const error = new Error("Withdrawal request not found");
            error.statusCode = 404;
            throw error;
        }

        if (String(existingRequest.user_id) !== ownerId) {
            const error = new Error("You are not allowed to cancel this withdrawal request");
            error.statusCode = 403;
            throw error;
        }

        if (existingRequest.status !== "PENDING") {
            const error = new Error(`Only PENDING withdrawal request can be cancelled. Current status: ${existingRequest.status}`);
            error.statusCode = 400;
            throw error;
        }

        const session = await mongoose.startSession();
        let updatedRequest = null;

        try {
            await session.withTransaction(async () => {
                const liveRequest = await WithdrawalRequest.findOne({ id: normalizedRequestId }).session(session);
                if (!liveRequest) {
                    const error = new Error("Withdrawal request not found");
                    error.statusCode = 404;
                    throw error;
                }

                if (String(liveRequest.user_id) !== ownerId) {
                    const error = new Error("You are not allowed to cancel this withdrawal request");
                    error.statusCode = 403;
                    throw error;
                }

                if (liveRequest.status !== "PENDING") {
                    const error = new Error(`Only PENDING withdrawal request can be cancelled. Current status: ${liveRequest.status}`);
                    error.statusCode = 400;
                    throw error;
                }

                const wallet = await this.getOrCreateWalletByUserId(liveRequest.user_id, session);
                const balanceBefore = Number(wallet.balance || 0);
                const balanceAfter = Number((balanceBefore + Number(liveRequest.amount || 0)).toFixed(2));

                wallet.balance = balanceAfter;
                await wallet.save({ session });

                const holdWalletTransaction = await WalletTransaction.findOne({
                    wallet_id: wallet.id,
                    reference_id: liveRequest.id,
                    type: "WITHDRAWAL_HOLD",
                }).session(session);

                if (holdWalletTransaction) {
                    holdWalletTransaction.type = "WITHDRAWAL_REFUND";
                    holdWalletTransaction.description = `Refund cancelled withdrawal ${liveRequest.id}`;
                    holdWalletTransaction.balance_before = balanceBefore;
                    holdWalletTransaction.balance_after = balanceAfter;
                    await holdWalletTransaction.save({ session });
                } else {
                    await WalletTransaction.create([
                        {
                            wallet_id: wallet.id,
                            amount: Number(liveRequest.amount || 0),
                            type: "WITHDRAWAL_REFUND",
                            transaction_id: null,
                            reference_id: liveRequest.id,
                            description: `Refund cancelled withdrawal ${liveRequest.id}`,
                            balance_before: balanceBefore,
                            balance_after: balanceAfter,
                        },
                    ], { session });
                }

                await adminLedgerService.createEntry(
                    {
                        type: "ESCROW_CREDIT",
                        amount: Number(liveRequest.amount || 0),
                        source: "WITHDRAWAL_REFUND",
                        dedupe_key: `WITHDRAWAL_REFUND:${liveRequest.id}`,
                        user_id: String(liveRequest.user_id || ""),
                        wallet_id: wallet.id,
                        withdrawal_request_id: liveRequest.id,
                        reference_id: liveRequest.id,
                        description: `Withdrawal refund (cancelled) ${liveRequest.id}`,
                    },
                    session,
                );

                liveRequest.status = "CANCELLED";
                liveRequest.processed_at = now;
                liveRequest.processed_by = ownerId;
                liveRequest.note = normalizedNote;
                await liveRequest.save({ session });

                updatedRequest = liveRequest;
            });
        } finally {
            session.endSession();
        }

        return {
            decision: "CANCEL",
            request: this.toWithdrawalRequestResponse(updatedRequest),
        };
    }
}

module.exports = new WalletService();
