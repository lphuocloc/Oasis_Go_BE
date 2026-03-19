const vnpayService = require("../utils/vnpayService");
const Transaction = require("../models/Transaction");
const BookingOrder = require("../models/BookingOrder");
const Booking = require("../models/Bookings");
const OnlineKey = require("../models/OnlineKey");
const { randomInt } = require("crypto");

class PaymentService {
    async _generateOnlineKeyToken() {
        const MAX_RETRY = 10;

        for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
            const token = String(randomInt(0, 1000000)).padStart(6, "0");
            const exists = await OnlineKey.exists({ key_token: token, is_revoked: false });
            if (!exists) {
                return token;
            }
        }

        const error = new Error("Unable to generate unique online key token");
        error.statusCode = 500;
        throw error;
    }

    async _ensureOnlineKeysForOrder(orderId) {
        const REQUIRED_KEY_TYPES = ["CUSTOMER", "CLEANER"];
        const bookings = await Booking.find({
            order_id: orderId,
            status: { $in: ["BOOKED", "IN_USE", "COMPLETED"] },
        })
            .select("id pod_id user_id start_time end_time")
            .lean();

        if (bookings.length === 0) {
            return { created: 0, totalBookings: 0 };
        }

        const bookingIds = bookings.map((booking) => booking.id);
        const existingKeys = await OnlineKey.find({
            booking_id: { $in: bookingIds },
            key_type: { $in: REQUIRED_KEY_TYPES },
        })
            .select("booking_id key_type")
            .lean();

        const existingKeyByBookingAndType = new Set(
            existingKeys.map((key) => `${key.booking_id}:${key.key_type}`)
        );
        const CHECKIN_GRACE_PERIOD_MS = 15 * 60 * 1000;
        const CLEANER_EXTRA_MINUTES_MS = 30 * 60 * 1000;

        const docsToCreate = [];
        for (const booking of bookings) {
            for (const keyType of REQUIRED_KEY_TYPES) {
                const dedupeKey = `${booking.id}:${keyType}`;
                if (existingKeyByBookingAndType.has(dedupeKey)) {
                    continue;
                }

                docsToCreate.push({
                    booking_id: booking.id,
                    pod_id: booking.pod_id,
                    user_id: String(booking.user_id),
                    key_type: keyType,
                    key_token: await this._generateOnlineKeyToken(),
                    valid_from:
                        keyType === "CLEANER"
                            ? new Date(booking.start_time)
                            : new Date(new Date(booking.start_time).getTime() - CHECKIN_GRACE_PERIOD_MS),
                    valid_to:
                        keyType === "CLEANER"
                            ? new Date(new Date(booking.end_time).getTime() + CLEANER_EXTRA_MINUTES_MS)
                            : new Date(booking.end_time),
                    is_revoked: false,
                });
            }
        }

        if (docsToCreate.length === 0) {
            return { created: 0, totalBookings: bookings.length };
        }

        await OnlineKey.insertMany(docsToCreate, { ordered: false });
        return { created: docsToCreate.length, totalBookings: bookings.length };
    }

    /**
     * Tạo payment và generate VNPay URL
     */
    async createPayment({ bookingOrderId, amount, orderInfo, ipAddr }) {
        const resolvedBookingOrderId = bookingOrderId;

        // Validate input
        if (!resolvedBookingOrderId || !amount || !orderInfo) {
            throw new Error("Missing required fields: bookingOrderId, amount, orderInfo");
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
            throw new Error("Invalid amount");
        }

        // Use BookingOrder ID as VNPay orderId
        const orderId = resolvedBookingOrderId;

        const bookingOrder = await BookingOrder.findOne({ id: orderId });
        if (!bookingOrder) {
            const error = new Error("Booking order not found");
            error.statusCode = 404;
            throw error;
        }

        if (bookingOrder.status !== "PENDING") {
            const error = new Error(`Cannot create transaction for order with status: ${bookingOrder.status}`);
            error.statusCode = 400;
            throw error;
        }

        const existingCharge = await Transaction.findOne({
            order_id: orderId,
            type: "CHARGE",
            status: { $in: ["PENDING", "SUCCESS"] },
        }).sort({ created_at: -1 });

        if (existingCharge && existingCharge.status === "SUCCESS") {
            const error = new Error("Order has already been paid");
            error.statusCode = 400;
            throw error;
        }

        if (existingCharge && existingCharge.status === "PENDING") {
            const paymentUrl = vnpayService.createPaymentUrl({
                orderId,
                amount: parseFloat(existingCharge.amount),
                orderInfo,
                orderType: "billpayment",
                ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
                locale: "vn",
                bankCode: "NCB",
            });

            return {
                transactionId: existingCharge.id,
                orderId,
                amount: existingCharge.amount,
                orderInfo,
                paymentUrl,
                status: existingCharge.status,
                createdAt: existingCharge.created_at,
            };
        }

        // Tạo transaction record trong database (PENDING status)
        const transaction = await Transaction.create({
            order_id: orderId,
            amount: parseFloat(amount),
            currency: "VND",
            type: "CHARGE",
            method: "VNPAY",
            status: "PENDING",
        });

        // Tạo payment URL
        const paymentUrl = vnpayService.createPaymentUrl({
            orderId,
            amount: parseFloat(amount),
            orderInfo,
            orderType: "billpayment",
            ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
            locale: "vn",
            bankCode: "NCB",
        });

        console.log("Create transaction request:", {
            transactionId: transaction.id,
            orderId,
            amount,
            status: transaction.status,
            timestamp: new Date().toISOString(),
        });

        return {
            transactionId: transaction.id,
            orderId,
            amount: transaction.amount,
            orderInfo,
            paymentUrl,
            status: transaction.status,
            createdAt: transaction.created_at,
        };
    }

    /**
     * Xử lý VNPay return/callback
     */
    async handleVnpayReturn(vnpayParams) {
        console.log("VNPay return params:", vnpayParams);

        const verifyResult = vnpayService.verifyReturnUrl({ ...vnpayParams });
        const isValid = verifyResult && verifyResult.isValid;

        if (!isValid) {
            const error = new Error("Invalid signature");
            error.statusCode = 400;
            throw error;
        }

        // Extract data
        const orderId = vnpayParams.vnp_TxnRef;
        const responseCode = vnpayParams.vnp_ResponseCode;
        const transactionNo = vnpayParams.vnp_TransactionNo;
        const amount = parseInt(vnpayParams.vnp_Amount) / 100; // VNPay trả về số tiền x100
        const bankCode = vnpayParams.vnp_BankCode;
        const payDate = vnpayParams.vnp_PayDate;

        const transaction = await Transaction.findOne({
            order_id: orderId,
            type: "CHARGE",
        }).sort({ created_at: -1 });

        if (!transaction) {
            const error = new Error("Transaction not found");
            error.statusCode = 404;
            throw error;
        }

        if (transaction.status !== "PENDING") {
            if (responseCode === "00" && transaction.status === "SUCCESS") {
                await this._ensureOnlineKeysForOrder(orderId);
            }

            return {
                code: responseCode,
                message: "Transaction already processed",
                transactionId: transaction.id,
                orderId: transaction.order_id,
                status: transaction.status,
                amount: transaction.amount,
            };
        }

        let newStatus;
        let message;

        if (responseCode === "00") {
            newStatus = "SUCCESS";
            message = "Transaction successful";
        } else {
            newStatus = "FAILED";
            message = "Transaction failed";
        }

        transaction.status = newStatus;
        transaction.provider_reference = transactionNo || transaction.provider_reference;
        await transaction.save();

        if (newStatus === "SUCCESS") {
            await BookingOrder.updateOne(
                { id: orderId, status: "PENDING" },
                { $set: { status: "PAID" } },
            );

            await this._ensureOnlineKeysForOrder(orderId);
        }

        console.log(`Transaction ${orderId} updated to ${newStatus}:`, {
            transactionId: transaction.id,
            transactionNo,
            amount,
            bankCode,
            payDate,
            timestamp: new Date().toISOString(),
        });

        return {
            code: responseCode,
            message,
            transactionId: transaction.id,
            orderId: transaction.order_id,
            transactionNo,
            amount: transaction.amount,
            status: transaction.status,
            bankCode,
            paymentDate: payDate || null,
        };
    }

    /**
     * Query payment status từ VNPay
     */
    async queryPaymentStatus({ orderId, transactionDate }) {
        // Validate input
        if (!orderId || !transactionDate) {
            throw new Error("orderId and transactionDate are required");
        }

        // Validate date format (YYYYMMDD)
        const dateRegex = /^\d{8}$/;
        if (!dateRegex.test(transactionDate)) {
            throw new Error("transactionDate must be in YYYYMMDD format");
        }

        const transaction = await Transaction.findOne({
            order_id: orderId,
            type: "CHARGE",
        }).sort({ created_at: -1 });

        if (!transaction) {
            const error = new Error("Transaction not found in database");
            error.statusCode = 404;
            throw error;
        }

        return {
            localTransaction: {
                transactionId: transaction.id,
                orderId: transaction.order_id,
                amount: transaction.amount,
                status: transaction.status,
                providerReference: transaction.provider_reference,
                createdAt: transaction.created_at,
            },
            vnpayQuery: {
                supported: false,
                message: "VNPay query API is not implemented in this service",
                orderId,
                transactionDate,
            },
        };
    }

    /**
     * Refund payment qua VNPay
     */
    async refundPayment({ orderId, transactionDate, amount, reason, ipAddr }) {
        // Validate input
        if (!orderId || !transactionDate || !amount) {
            throw new Error("orderId, transactionDate, and amount are required");
        }

        // Validate date format
        const dateRegex = /^\d{8}$/;
        if (!dateRegex.test(transactionDate)) {
            throw new Error("transactionDate must be in YYYYMMDD format");
        }

        const transaction = await Transaction.findOne({
            order_id: orderId,
            type: "CHARGE",
        }).sort({ created_at: -1 });

        if (!transaction) {
            const error = new Error("Transaction not found in database");
            error.statusCode = 404;
            throw error;
        }

        if (transaction.status !== "SUCCESS") {
            const error = new Error(`Cannot refund transaction with status: ${transaction.status}. Only SUCCESS transactions can be refunded.`);
            error.statusCode = 400;
            throw error;
        }

        if (amount > transaction.amount) {
            throw new Error(`Refund amount (${amount}) cannot exceed transaction amount (${transaction.amount})`);
        }

        const refundTransaction = await Transaction.create({
            order_id: orderId,
            amount: parseFloat(amount),
            currency: "VND",
            type: "REFUND",
            method: transaction.method || "VNPAY",
            status: "SUCCESS",
            provider_reference: transaction.provider_reference || null,
        });

        return {
            transaction: {
                transactionId: transaction.id,
                orderId: transaction.order_id,
                amount: transaction.amount,
                status: transaction.status,
            },
            refund: {
                transactionId: refundTransaction.id,
                orderId: refundTransaction.order_id,
                amount: refundTransaction.amount,
                status: refundTransaction.status,
                reason: reason || "Customer request",
                transactionDate,
                ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
            },
        };
    }

    /**
     * Lấy payment theo orderId
     */
    async getPaymentByOrderId(orderId) {
        const transaction = await Transaction.findOne({
            order_id: orderId,
            type: "CHARGE",
        }).sort({ created_at: -1 });

        if (!transaction) {
            const error = new Error("Transaction not found");
            error.statusCode = 404;
            throw error;
        }

        return transaction;
    }

    /**
     * Lấy payment theo paymentId
     */
    async getPaymentByPaymentId(paymentId) {
        const transaction = await Transaction.findOne({ id: paymentId });

        if (!transaction) {
            const error = new Error("Transaction not found");
            error.statusCode = 404;
            throw error;
        }

        return transaction;
    }

    /**
     * Lấy tất cả payments với filters
     */
    async getAllPayments({ status, method, bookingId, startDate, endDate }) {
        const filter = {};

        if (status) filter.status = status;
        if (method) filter.method = method;
        if (bookingId) filter.order_id = bookingId;

        if (startDate || endDate) {
            filter.created_at = {};
            if (startDate) filter.created_at.$gte = new Date(startDate);
            if (endDate) filter.created_at.$lte = new Date(endDate);
        }

        const payments = await Transaction.find(filter).sort({ created_at: -1 });

        return payments;
    }

    /**
     * Lấy tất cả transactions của user hiện tại
     * @param {String} userId - User ID từ token
     * @param {Object} options - Pagination options
     * @returns {Promise<Object>} Danh sách transactions và metadata phân trang
     */
    async getMyTransactions(userId, options = {}) {
        if (!userId) {
            const error = new Error("User ID is required");
            error.statusCode = 400;
            throw error;
        }

        const page = Math.max(parseInt(options.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 100);
        const skip = (page - 1) * limit;

        const bookingOrders = await BookingOrder.find({ user_id: String(userId) })
            .select("id")
            .lean();

        const orderIds = bookingOrders.map((order) => order.id);

        if (orderIds.length === 0) {
            return {
                transactions: [],
                pagination: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0,
                },
            };
        }

        const filter = {
            order_id: { $in: orderIds },
        };

        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit),
            Transaction.countDocuments(filter),
        ]);

        return {
            transactions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Lấy tất cả transactions (admin/internal)
     * @param {Object} options - Filters và pagination
     * @returns {Promise<Object>} Danh sách transactions và metadata phân trang
     */
    async getAllTransactions(options = {}) {
        const {
            status,
            method,
            type,
            orderId,
            startDate,
            endDate,
            page,
            limit,
        } = options;

        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
        const skip = (currentPage - 1) * pageSize;

        const filter = {};
        if (status) filter.status = status;
        if (method) filter.method = method;
        if (type) filter.type = type;
        if (orderId) filter.order_id = orderId;

        if (startDate || endDate) {
            filter.created_at = {};
            if (startDate) filter.created_at.$gte = new Date(startDate);
            if (endDate) filter.created_at.$lte = new Date(endDate);
        }

        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(pageSize),
            Transaction.countDocuments(filter),
        ]);

        return {
            transactions,
            pagination: {
                page: currentPage,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        };
    }
}

module.exports = new PaymentService();
