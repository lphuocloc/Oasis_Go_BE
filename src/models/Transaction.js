const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const transactionSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        order_id: {
            type: String,
            required: [true, "Order ID is required"],
            index: true,
            ref: "BookingOrder",
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
        },
        currency: {
            type: String,
            default: "VND",
            required: true,
            trim: true,
        },
        type: {
            type: String,
            enum: {
                values: ["CHARGE", "REFUND", "PENALTY", "TOPUP"],
                message: "{VALUE} is not a valid transaction type",
            },
            default: "CHARGE",
            required: true,
            index: true,
        },
        method: {
            type: String,
            enum: {
                values: ["VNPAY"],
                message: "{VALUE} is not a valid payment method",
            },
            default: "VNPAY",
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: {
                values: ["PENDING", "SUCCESS", "FAILED", "VOIDED"],
                message: "{VALUE} is not a valid transaction status",
            },
            default: "PENDING",
            required: true,
            index: true,
        },
        provider_reference: {
            type: String,
            default: null,
            trim: true,
            index: true,
        },
        created_at: {
            type: Date,
            default: Date.now,
            required: true,
            index: true,
        },
    },
    {
        versionKey: false,
    },
);

transactionSchema.index({ order_id: 1, created_at: -1 });
transactionSchema.index({ status: 1, created_at: -1 });
transactionSchema.index({ method: 1, status: 1, created_at: -1 });

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
