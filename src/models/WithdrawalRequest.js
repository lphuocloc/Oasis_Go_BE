const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const withdrawalRequestSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        user_id: {
            type: String,
            required: [true, "User ID is required"],
            index: true,
            ref: "User",
        },
        wallet_id: {
            type: String,
            required: [true, "Wallet ID is required"],
            index: true,
            ref: "Wallet",
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0.01, "Amount must be greater than 0"],
        },
        status: {
            type: String,
            enum: {
                values: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
                message: "{VALUE} is not a valid withdrawal request status",
            },
            default: "PENDING",
            required: true,
            index: true,
        },
        bank_name_snapshot: {
            type: String,
            required: [true, "Bank name is required"],
            trim: true,
        },
        bank_account_number_snapshot: {
            type: String,
            required: [true, "Bank account number is required"],
            trim: true,
        },
        note: {
            type: String,
            default: null,
            trim: true,
            maxlength: [300, "Note cannot exceed 300 characters"],
        },
        requested_at: {
            type: Date,
            default: Date.now,
            required: true,
            index: true,
        },
        processed_at: {
            type: Date,
            default: null,
        },
        processed_by: {
            type: String,
            default: null,
            ref: "User",
            index: true,
        },
        updated_at: {
            type: Date,
            default: Date.now,
            required: true,
        },
    },
    {
        versionKey: false,
    }
);

withdrawalRequestSchema.pre("save", function () {
    this.updated_at = new Date();
});

withdrawalRequestSchema.index({ user_id: 1, requested_at: -1 });
withdrawalRequestSchema.index({ status: 1, requested_at: -1 });

module.exports = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);
