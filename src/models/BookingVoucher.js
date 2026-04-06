const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingVoucherSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        order_id: {
            type: String,
            required: [true, "order_id is required"],
            ref: "BookingOrder",
            index: true,
            unique: true,
        },
        voucher_id: {
            type: String,
            required: [true, "voucher_id is required"],
            ref: "Voucher",
            index: true,
        },
        discount_amount: {
            type: Number,
            required: [true, "discount_amount is required"],
            min: [0, "discount_amount cannot be negative"],
        },
        applied_at: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        collection: "booking_vouchers",
    }
);

bookingVoucherSchema.index({ voucher_id: 1, applied_at: -1 });
bookingVoucherSchema.index({ order_id: 1, voucher_id: 1 }, { unique: true });

module.exports = mongoose.model("BookingVoucher", bookingVoucherSchema);
