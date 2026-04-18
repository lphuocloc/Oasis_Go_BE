const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const DISCOUNT_TYPES = ["PERCENT", "FIXED"];

const voucherSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        code: {
            type: String,
            required: [true, "Voucher code is required"],
            unique: true,
            trim: true,
            uppercase: true,
            index: true,
        },
        description: {
            type: String,
            default: null,
            trim: true,
        },
        discount_type: {
            type: String,
            required: [true, "Discount type is required"],
            enum: {
                values: DISCOUNT_TYPES,
                message: "{VALUE} is not a valid discount type",
            },
            trim: true,
            uppercase: true,
        },
        discount_value: {
            type: Number,
            required: [true, "Discount value is required"],
            min: [0, "Discount value cannot be negative"],
        },
        max_discount: {
            type: Number,
            default: null,
            min: [0, "Max discount cannot be negative"],
        },
        min_booking_value: {
            type: Number,
            default: 0,
            min: [0, "Minimum booking value cannot be negative"],
        },
        valid_from: {
            type: Date,
            required: [true, "valid_from is required"],
            index: true,
        },
        valid_to: {
            type: Date,
            required: [true, "valid_to is required"],
            index: true,
        },
        usage_limit: {
            type: Number,
            default: null,
            min: [0, "Usage limit cannot be negative"],
        },
        usage_count: {
            type: Number,
            default: 0,
            min: [0, "Usage count cannot be negative"],
        },
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
        collection: "vouchers",
    }
);

voucherSchema.pre("validate", function () {
    if (this.valid_from && this.valid_to && this.valid_to < this.valid_from) {
        this.invalidate("valid_to", "valid_to must be greater than or equal to valid_from");
    }

    if (this.discount_type === "PERCENT" && this.discount_value > 100) {
        this.invalidate("discount_value", "discount_value cannot exceed 100 for PERCENT discount");
    }

    if (this.usage_limit !== null && this.usage_limit !== undefined && this.usage_count > this.usage_limit) {
        this.invalidate("usage_count", "usage_count cannot exceed usage_limit");
    }
});

voucherSchema.index({ is_active: 1, valid_from: 1, valid_to: 1 });

module.exports = mongoose.model("Voucher", voucherSchema);
