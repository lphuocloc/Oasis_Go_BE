const BookingVoucher = require("../models/BookingVoucher");
const BookingOrder = require("../models/BookingOrder");
const Voucher = require("../models/Voucher");

const createError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const toNonNegativeNumber = (value, fieldName) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        throw createError(`${fieldName} must be a non-negative number`, 400);
    }
    return num;
};

class BookingVoucherService {
    async createBookingVoucher(payload = {}) {
        const orderId = String(payload.order_id || "").trim();
        const voucherId = String(payload.voucher_id || "").trim();

        if (!orderId || !voucherId) {
            throw createError("order_id and voucher_id are required", 400);
        }

        const discountAmount = toNonNegativeNumber(payload.discount_amount, "discount_amount");

        const [order, voucher, existed] = await Promise.all([
            BookingOrder.findOne({ id: orderId }).select("id").lean(),
            Voucher.findOne({ id: voucherId }).select("id").lean(),
            BookingVoucher.findOne({ order_id: orderId }).select("id voucher_id").lean(),
        ]);

        if (!order) {
            throw createError("Booking order not found", 404);
        }

        if (!voucher) {
            throw createError("Voucher not found", 404);
        }

        if (existed) {
            throw createError("This order already has a voucher record", 409);
        }

        const bookingVoucher = await BookingVoucher.create({
            order_id: orderId,
            voucher_id: voucherId,
            discount_amount: discountAmount,
            applied_at: payload.applied_at ? new Date(payload.applied_at) : new Date(),
        });

        return bookingVoucher;
    }

    async getBookingVouchers(query = {}) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

        const filter = {};
        if (query.order_id) {
            filter.order_id = String(query.order_id).trim();
        }
        if (query.voucher_id) {
            filter.voucher_id = String(query.voucher_id).trim();
        }

        const [items, total] = await Promise.all([
            BookingVoucher.find(filter)
                .sort({ applied_at: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            BookingVoucher.countDocuments(filter),
        ]);

        return {
            items,
            pagination: {
                current_page: page,
                total_pages: Math.ceil(total / limit),
                total_items: total,
                items_per_page: limit,
            },
        };
    }

    async getBookingVoucherById(id) {
        const record = await BookingVoucher.findOne({ id });
        if (!record) {
            throw createError("Booking voucher record not found", 404);
        }
        return record;
    }

    async deleteBookingVoucher(id) {
        const record = await BookingVoucher.findOne({ id }).select("id");
        if (!record) {
            throw createError("Booking voucher record not found", 404);
        }

        await BookingVoucher.deleteOne({ id });
        return { message: "Booking voucher record deleted successfully" };
    }
}

module.exports = new BookingVoucherService();
