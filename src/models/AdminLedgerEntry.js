const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const adminLedgerEntrySchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        type: {
            type: String,
            enum: {
                values: [
                    "ESCROW_CREDIT",
                    "ESCROW_DEBIT",
                    "REVENUE_RECOGNIZED",
                    "PAYOUT",
                ],
                message: "{VALUE} is not a valid admin ledger type",
            },
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: [0, "amount cannot be negative"],
        },
        escrow_delta: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            default: "VND",
            required: true,
            trim: true,
        },
        source: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        dedupe_key: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        user_id: {
            type: String,
            default: null,
            index: true,
            ref: "User",
        },
        wallet_id: {
            type: String,
            default: null,
            index: true,
            ref: "Wallet",
        },
        order_id: {
            type: String,
            default: null,
            index: true,
            ref: "BookingOrder",
        },
        transaction_id: {
            type: String,
            default: null,
            index: true,
            ref: "Transaction",
        },
        wallet_transaction_id: {
            type: String,
            default: null,
            index: true,
            ref: "WalletTransaction",
        },
        withdrawal_request_id: {
            type: String,
            default: null,
            index: true,
            ref: "WithdrawalRequest",
        },
        reference_id: {
            type: String,
            default: null,
            index: true,
            trim: true,
        },
        description: {
            type: String,
            default: null,
            trim: true,
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
        collection: "admin_ledger_entries",
    }
);

adminLedgerEntrySchema.index({ type: 1, created_at: -1 });
adminLedgerEntrySchema.index({ source: 1, created_at: -1 });
adminLedgerEntrySchema.index({ order_id: 1, created_at: -1 });
adminLedgerEntrySchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model("AdminLedgerEntry", adminLedgerEntrySchema);
