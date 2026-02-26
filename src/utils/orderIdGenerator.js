const Payment = require('../models/payment/Payment');

/**
 * Generate orderId theo format: ORDER-YYYYMMDD-XXX
 * XXX là số tăng dần trong ngày (001, 002, 003...)
 * 
 * @returns {Promise<string>} OrderId mới
 */
async function generateOrderId() {
    try {
        // Lấy ngày hiện tại (giờ Việt Nam - UTC+7)
        const now = new Date();
        const vnDate = new Date(now.getTime() + (7 * 60 * 60 * 1000));

        // Format: YYYYMMDD
        const dateStr = vnDate.toISOString().slice(0, 10).replace(/-/g, '');

        // Tìm orderId cuối cùng của ngày hôm nay
        const prefix = `ORDER-${dateStr}-`;

        // Query tất cả orders của ngày hôm nay
        const todayOrders = await Payment.find({
            orderId: { $regex: `^${prefix}` }
        })
            .sort({ orderId: -1 })
            .limit(1)
            .select('orderId');

        let sequence = 1;

        if (todayOrders.length > 0) {
            // Parse số thứ tự từ orderId cuối cùng
            const lastOrderId = todayOrders[0].orderId;
            const lastSequence = lastOrderId.split('-')[2];
            sequence = parseInt(lastSequence, 10) + 1;
        }

        // Format số thứ tự thành 3 chữ số (001, 002, ...)
        const sequenceStr = sequence.toString().padStart(3, '0');

        // Tạo orderId mới
        const newOrderId = `${prefix}${sequenceStr}`;

        return newOrderId;

    } catch (error) {
        console.error('Generate orderId error:', error);
        // Fallback: dùng timestamp nếu có lỗi
        const timestamp = Date.now();
        return `ORDER-${timestamp}`;
    }
}

module.exports = {
    generateOrderId
};
