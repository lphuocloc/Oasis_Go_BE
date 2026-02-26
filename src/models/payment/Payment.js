const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    // UUID-like ID (MongoDB sẽ tự tạo _id, nhưng có thể dùng field này nếu cần)
    paymentId: {
        type: String,
        required: true,
        unique: true,
        default: () => require('crypto').randomUUID()
    },

    // Booking ID (giả lập, sau này sẽ reference đến Booking model)
    bookingId: {
        type: String,
        required: true,
        index: true
    },

    // Order ID từ VNPay (vnp_TxnRef)
    orderId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Số tiền thanh toán
    amount: {
        type: Number,
        required: true,
        min: 0
    },

    // Phương thức thanh toán
    method: {
        type: String,
        enum: ['VNPAY'],
        default: 'VNPAY',
        required: true
    },

    // Trạng thái thanh toán
    status: {
        type: String,
        enum: ['INITIATED', 'AUTHORIZED', 'FAILED', 'REFUNDED', 'CANCELLED'],
        default: 'INITIATED',
        required: true
    },

    // Thông tin chi tiết từ VNPay
    vnpayData: {
        transactionNo: String,        // Mã giao dịch VNPay
        bankCode: String,              // Ngân hàng thanh toán
        cardType: String,              // Loại thẻ
        responseCode: String,          // Mã phản hồi từ VNPay
        transactionStatus: String,     // Trạng thái giao dịch
        payDate: String,               // Ngày thanh toán
        secureHash: String             // Hash để verify
    },

    // Thông tin đơn hàng
    orderInfo: {
        type: String,
        required: true
    },

    // Thời gian tạo
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },

    // Thời gian cập nhật
    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Thời gian thanh toán thành công
    authorizedAt: {
        type: Date
    }
}, {
    timestamps: true // Tự động tạo createdAt và updatedAt
});

// Index để tìm kiếm nhanh
paymentSchema.index({ bookingId: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ orderId: 1 });

// Method để cập nhật trạng thái
paymentSchema.methods.updateStatus = function (status, vnpayData = {}) {
    this.status = status;

    if (status === 'AUTHORIZED') {
        this.authorizedAt = new Date();
    }

    if (vnpayData && Object.keys(vnpayData).length > 0) {
        this.vnpayData = {
            ...this.vnpayData,
            ...vnpayData
        };
    }

    this.updatedAt = new Date();
    return this.save();
};

// Static method để tạo payment mới
paymentSchema.statics.createPayment = async function (data) {
    const payment = new this({
        bookingId: data.bookingId,
        orderId: data.orderId,
        amount: data.amount,
        method: data.method || 'VNPAY',
        status: 'INITIATED',
        orderInfo: data.orderInfo
    });

    return await payment.save();
};

// Static method để tìm payment theo orderId
paymentSchema.statics.findByOrderId = function (orderId) {
    return this.findOne({ orderId });
};

// Static method để tìm payment theo bookingId
paymentSchema.statics.findByBookingId = function (bookingId) {
    return this.find({ bookingId });
};

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
