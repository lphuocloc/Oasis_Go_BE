const vnpayService = require('../../utils/vnpayService');
const Payment = require('../../models/payment/Payment');
const { generateOrderId } = require('../../utils/orderIdGenerator');

/**
 * Tạo URL thanh toán VNPay
 * POST /api/vnpay/create-payment
 * Body: {
 *   bookingId: string (optional),
 *   amount: number (required),
 *   orderInfo: string (required)
 * }
 * Note: 
 * - orderId tự động generate theo format ORDER-YYYYMMDD-XXX
 * - orderType mặc định: 'billpayment'
 * - locale mặc định: 'vn'
 * - bankCode mặc định: '' (hiển thị tất cả ngân hàng)
 */
exports.createPayment = async (req, res) => {
    try {
        const { bookingId, amount, orderInfo } = req.body;

        // Validate input
        if (!amount || !orderInfo) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: amount, orderInfo'
            });
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }

        // Auto-generate orderId theo format ORDER-YYYYMMDD-XXX
        const orderId = await generateOrderId();

        // Lấy IP của client
        const ipAddr = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress ||
            '127.0.0.1';

        // Tạo payment record trong database (INITIATED status)
        const payment = await Payment.createPayment({
            bookingId: bookingId || `BOOKING-${Date.now()}`, // Data giả nếu không có
            orderId,
            amount: parseFloat(amount),
            method: 'VNPAY',
            orderInfo
        });

        // Tạo payment URL với các giá trị mặc định
        const paymentUrl = vnpayService.createPaymentUrl({
            orderId,
            amount: parseFloat(amount),
            orderInfo,
            orderType: 'billpayment',  // Mặc định
            ipAddr: ipAddr.replace('::ffff:', ''),
            locale: 'vn',
            bankCode: 'NCB'
        });

        // Log để debug
        console.log('Create payment request:', {
            paymentId: payment.paymentId,
            bookingId: payment.bookingId,
            orderId,
            amount,
            status: payment.status,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: 'Create payment URL successfully',
            data: {
                paymentId: payment.paymentId,
                bookingId: payment.bookingId,
                orderId: payment.orderId,
                amount: payment.amount,
                status: payment.status,
                paymentUrl
            }
        });

    } catch (error) {
        console.error('Create payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * VNPay Return URL (người dùng redirect về sau khi thanh toán)
 * GET /api/vnpay/return
 */
exports.vnpayReturn = async (req, res) => {
    try {
        const vnpParams = req.query;

        // Verify signature
        const verifyResult = vnpayService.verifyReturnUrl(vnpParams);

        if (!verifyResult.isValid) {
            // Signature không hợp lệ
            return res.status(400).json({
                success: false,
                message: 'Invalid signature'
            });
        }

        const { orderId, amount, isSuccess, responseCode, transactionNo, bankCode, payDate, transactionStatus } = verifyResult.data;

        // Tìm payment trong database
        const payment = await Payment.findByOrderId(orderId);

        if (!payment) {
            console.error('Payment not found:', orderId);
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        // Log cho mục đích debug
        console.log('VNPay return:', {
            paymentId: payment.paymentId,
            orderId,
            isSuccess,
            responseCode,
            timestamp: new Date().toISOString()
        });

        // Xử lý theo response code
        if (isSuccess) {
            // Thanh toán thành công - cập nhật payment
            await payment.updateStatus('AUTHORIZED', {
                transactionNo,
                bankCode,
                responseCode,
                transactionStatus,
                payDate
            });

            return res.status(200).json({
                success: true,
                message: 'Payment successful',
                data: {
                    paymentId: payment.paymentId,
                    bookingId: payment.bookingId,
                    orderId: payment.orderId,
                    amount: payment.amount,
                    status: payment.status,
                    transactionNo,
                    bankCode,
                    payDate
                }
            });
        } else {
            // Thanh toán thất bại - cập nhật payment
            await payment.updateStatus('FAILED', {
                responseCode,
                transactionStatus
            });

            return res.status(400).json({
                success: false,
                message: 'Payment failed',
                data: {
                    paymentId: payment.paymentId,
                    orderId: payment.orderId,
                    status: payment.status,
                    responseCode
                }
            });
        }

    } catch (error) {
        console.error('VNPay return error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * VNPay IPN (Instant Payment Notification)
 * GET /api/vnpay/ipn
 * 
 * Endpoint này được VNPay gọi để thông báo kết quả thanh toán
 * QUAN TRỌNG: Phải trả về đúng format response code cho VNPay
 */
exports.vnpayIpn = async (req, res) => {
    try {
        const vnpParams = req.query;

        // Verify signature
        const verifyResult = vnpayService.verifyIpnCall(vnpParams);

        if (!verifyResult.isValid) {
            console.error('IPN Invalid signature:', vnpParams);
            // Trả về code 97: Signature không hợp lệ
            return res.status(200).json({ RspCode: '97', Message: 'Invalid signature' });
        }

        const { orderId, amount, isSuccess, responseCode, transactionNo, bankCode, payDate, transactionStatus } = verifyResult.data;

        // Log IPN call
        console.log('VNPay IPN received:', {
            orderId,
            amount,
            isSuccess,
            responseCode,
            transactionNo,
            timestamp: new Date().toISOString()
        });

        // Kiểm tra payment có tồn tại không
        const payment = await Payment.findByOrderId(orderId);
        if (!payment) {
            console.error('IPN: Payment not found:', orderId);
            return res.status(200).json({ RspCode: '01', Message: 'Order not found' });
        }

        // Kiểm tra số tiền có khớp không
        if (payment.amount !== amount) {
            console.error('IPN: Amount mismatch:', { expected: payment.amount, received: amount });
            return res.status(200).json({ RspCode: '04', Message: 'Invalid amount' });
        }

        // Kiểm tra trạng thái đơn hàng (đã được xử lý chưa)
        if (payment.status === 'AUTHORIZED') {
            console.log('IPN: Payment already confirmed:', orderId);
            return res.status(200).json({ RspCode: '02', Message: 'Order already confirmed' });
        }

        // Xử lý cập nhật trạng thái đơn hàng
        if (isSuccess) {
            // Cập nhật payment thành công
            await payment.updateStatus('AUTHORIZED', {
                transactionNo,
                bankCode,
                responseCode,
                transactionStatus,
                payDate
            });

            console.log(`IPN: Order ${orderId} payment confirmed successfully`);

            // TODO: Thêm logic nghiệp vụ khác
            // - Gửi email xác nhận
            // - Cập nhật booking status
            // - Tạo invoice
            // - Notify user qua app

            // Trả về code 00: Thành công
            return res.status(200).json({ RspCode: '00', Message: 'Success' });
        } else {
            // Cập nhật trạng thái thất bại
            await payment.updateStatus('FAILED', {
                responseCode,
                transactionStatus
            });

            console.log(`IPN: Order ${orderId} payment failed with code: ${responseCode}`);

            // Trả về code 00: Đã nhận được thông báo (không phải lỗi)
            return res.status(200).json({ RspCode: '00', Message: 'Success' });
        }

    } catch (error) {
        console.error('VNPay IPN error:', error);
        // Trả về code 99: Lỗi không xác định
        return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
    }
};

/**
 * Query payment status từ VNPay
 * POST /api/vnpay/query-status
 * Body: { orderId, transDate }
 * 
 * Note: Cần implement thêm nếu muốn query trạng thái giao dịch
 */
exports.queryPaymentStatus = async (req, res) => {
    try {
        // TODO: Implement VNPay query API
        return res.status(501).json({
            success: false,
            message: 'Query payment status feature not implemented yet'
        });
    } catch (error) {
        console.error('Query status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * Refund payment
 * POST /api/vnpay/refund
 * Body: { orderId, amount, transDate, ... }
 * 
 * Note: Cần implement thêm nếu muốn hoàn tiền
 */
exports.refundPayment = async (req, res) => {
    try {
        // TODO: Implement VNPay refund API
        return res.status(501).json({
            success: false,
            message: 'Refund payment feature not implemented yet'
        });
    } catch (error) {
        console.error('Refund error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * Get payment by orderId
 * GET /api/vnpay/payment/:orderId
 */
exports.getPaymentByOrderId = async (req, res) => {
    try {
        const { orderId } = req.params;

        const payment = await Payment.findByOrderId(orderId);

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Payment found',
            data: {
                paymentId: payment.paymentId,
                bookingId: payment.bookingId,
                orderId: payment.orderId,
                amount: payment.amount,
                method: payment.method,
                status: payment.status,
                orderInfo: payment.orderInfo,
                vnpayData: payment.vnpayData,
                createdAt: payment.createdAt,
                updatedAt: payment.updatedAt,
                authorizedAt: payment.authorizedAt
            }
        });

    } catch (error) {
        console.error('Get payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * Get payments by bookingId
 * GET /api/vnpay/payments/booking/:bookingId
 */
exports.getPaymentsByBookingId = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const payments = await Payment.findByBookingId(bookingId);

        return res.status(200).json({
            success: true,
            message: 'Payments found',
            count: payments.length,
            data: payments.map(p => ({
                paymentId: p.paymentId,
                bookingId: p.bookingId,
                orderId: p.orderId,
                amount: p.amount,
                method: p.method,
                status: p.status,
                orderInfo: p.orderInfo,
                createdAt: p.createdAt,
                authorizedAt: p.authorizedAt
            }))
        });

    } catch (error) {
        console.error('Get payments error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};
