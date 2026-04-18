const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingPricingDetailSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        booking_id: {
            type: String,
            required: [true, "Booking ID is required"],
            ref: "Booking",
            index: true,
        },
        pricing_rule_id: {
            type: String,
            default: null,
            ref: "PricingRule",
            index: true,
        },
        applied_modifier: {
            type: Number,
            required: [true, "Applied modifier is required"],
            min: [0, "Applied modifier cannot be negative"],
        },
        calculated_amount: {
            type: Number,
            required: [true, "Calculated amount is required"],
            min: [0, "Calculated amount cannot be negative"],
        },
    },
    {
        timestamps: true,
    }
);

bookingPricingDetailSchema.index({ booking_id: 1, createdAt: -1 });
bookingPricingDetailSchema.index({ pricing_rule_id: 1, createdAt: -1 });

module.exports = mongoose.model("BookingPricingDetail", bookingPricingDetailSchema);
