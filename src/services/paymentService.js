const vnpayService = require("../utils/vnpayService");
const Payment = require("../models/Payment");
const { generateOrderId } = require("../utils/orderIdGenerator");

class PaymentService {
    /**
     * Tạo payment và generate VNPay URL
     */
    async createPayment({ bookingId, amount, orderInfo, ipAddr }) {
        // Validate input
        if (!amount || !orderInfo) {
            throw new Error("Missing required fields: amount, orderInfo");
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
            throw new Error("Invalid amount");
        }

        // Auto-generate orderId
        const orderId = await generateOrderId();

        // Tạo payment record trong database (INITIATED status)
        const payment = await Payment.createPayment({
            bookingId: bookingId || `BOOKING-${Date.now()}`,
            orderId,
            amount: parseFloat(amount),
            method: "VNPAY",
            orderInfo,
        });

        // Tạo payment URL
        const paymentUrl = vnpayService.createPaymentUrl({
            orderId,
            amount: parseFloat(amount),
            orderInfo,
            orderType: "billpayment",
            ipAddr: ipAddr.replace("::ffff:", ""),
            locale: "vn",
            bankCode: "NCB",
        });

        // Log để debug
        console.log("Create payment request:", {
            paymentId: payment.paymentId,
            bookingId: payment.bookingId,
            orderId,
            amount,
            status: payment.status,
            timestamp: new Date().toISOString(),
        });

        return {
            paymentId: payment.paymentId,
            orderId,
            amount: payment.amount,
            orderInfo: payment.orderInfo,
            paymentUrl,
            status: payment.status,
            createdAt: payment.createdAt,
        };
    }

    /**
     * Xử lý VNPay return/callback
     */
    async handleVnpayReturn(vnpayParams) {
        console.log("VNPay return params:", vnpayParams);

        // Verify signature
        const isValid = vnpayService.verifyReturnUrl(vnpayParams);

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

        // Tìm payment record
        const payment = await Payment.findOne({ orderId });

        if (!payment) {
            const error = new Error("Payment not found");
            error.statusCode = 404;
            throw error;
        }

        // Kiểm tra payment đã được xử lý chưa
        if (payment.status !== "INITIATED") {
            console.log(`Payment ${orderId} already processed with status: ${payment.status}`);
            return {
                code: responseCode,
                message: "Payment already processed",
                paymentId: payment.paymentId,
                orderId: payment.orderId,
                status: payment.status,
                amount: payment.amount,
            };
        }

        // Update payment dựa vào response code
        let newStatus;
        let message;

        if (responseCode === "00") {
            // Thanh toán thành công
            newStatus = "COMPLETED";
            message = "Payment successful";
        } else {
            // Thanh toán thất bại
            newStatus = "FAILED";
            message = vnpayService.getResponseMessage(responseCode);
        }

        // Update payment record
        payment.status = newStatus;
        payment.transactionId = transactionNo;
        payment.bankCode = bankCode;
        payment.paymentDate = payDate
            ? new Date(
                `${payDate.slice(0, 4)}-${payDate.slice(4, 6)}-${payDate.slice(6, 8)}T${payDate.slice(8, 10)}:${payDate.slice(10, 12)}:${payDate.slice(12, 14)}`
            )
            : new Date();
        payment.vnpayResponse = vnpayParams;
        await payment.save();

        // Log
        console.log(`Payment ${orderId} updated to ${newStatus}:`, {
            paymentId: payment.paymentId,
            transactionNo,
            amount,
            bankCode,
            timestamp: new Date().toISOString(),
        });

        return {
            code: responseCode,
            message,
            paymentId: payment.paymentId,
            orderId: payment.orderId,
            bookingId: payment.bookingId,
            transactionNo,
            amount: payment.amount,
            status: payment.status,
            bankCode,
            paymentDate: payment.paymentDate,
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

        // Find payment để lấy thông tin
        const payment = await Payment.findOne({ orderId });

        if (!payment) {
            const error = new Error("Payment not found in database");
            error.statusCode = 404;
            throw error;
        }

        // Query VNPay
        const queryResult = vnpayService.queryTransaction({
            orderId,
            transactionDate,
            transactionNo: payment.transactionId || "",
        });

        return {
            localPayment: {
                paymentId: payment.paymentId,
                orderId: payment.orderId,
                amount: payment.amount,
                status: payment.status,
                transactionId: payment.transactionId,
                createdAt: payment.createdAt,
            },
            vnpayQuery: queryResult,
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

        // Find payment
        const payment = await Payment.findOne({ orderId });

        if (!payment) {
            const error = new Error("Payment not found in database");
            error.statusCode = 404;
            throw error;
        }

        // Validate payment status
        if (payment.status !== "COMPLETED") {
            const error = new Error(`Cannot refund payment with status: ${payment.status}. Only COMPLETED payments can be refunded.`);
            error.statusCode = 400;
            throw error;
        }

        // Validate refund amount
        if (amount > payment.amount) {
            throw new Error(`Refund amount (${amount}) cannot exceed payment amount (${payment.amount})`);
        }

        // Request refund từ VNPay
        const refundResult = vnpayService.refundTransaction({
            orderId,
            transactionDate,
            amount,
            transactionNo: payment.transactionId,
            reason: reason || "Customer request",
            ipAddr: ipAddr.replace("::ffff:", ""),
        });

        // Note: Trong thực tế, cần gọi API VNPay để refund
        // Đây chỉ là mock response
        return {
            payment: {
                paymentId: payment.paymentId,
                orderId: payment.orderId,
                amount: payment.amount,
                status: payment.status,
            },
            refund: refundResult,
        };
    }

    /**
     * Lấy payment theo orderId
     */
    async getPaymentByOrderId(orderId) {
        const payment = await Payment.findOne({ orderId });

        if (!payment) {
            const error = new Error("Payment not found");
            error.statusCode = 404;
            throw error;
        }

        return payment;
    }

    /**
     * Lấy payment theo paymentId
     */
    async getPaymentByPaymentId(paymentId) {
        const payment = await Payment.findOne({ paymentId });

        if (!payment) {
            const error = new Error("Payment not found");
            error.statusCode = 404;
            throw error;
        }

        return payment;
    }

    /**
     * Lấy tất cả payments với filters
     */
    async getAllPayments({ status, method, bookingId, startDate, endDate }) {
        const filter = {};

        if (status) filter.status = status;
        if (method) filter.method = method;
        if (bookingId) filter.bookingId = bookingId;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const payments = await Payment.find(filter).sort({ createdAt: -1 });

        return payments;
    }
}

module.exports = new PaymentService();
