const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const walletTransactionSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
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
        },
        type: {
            type: String,
            enum: {
                values: ["TOPUP", "PAYMENT", "REFUND", "WITHDRAWAL_HOLD", "WITHDRAWAL_SUCCESS", "WITHDRAWAL_REFUND"],
                message: "{VALUE} is not a valid wallet transaction type",
            },
            required: true,
            index: true,
        },
        transaction_id: {
            type: String,
            default: null,
            index: true,
            ref: "Transaction",
        },
        reference_id: {
            type: String,
            default: null,
            index: true,
        },
        description: {
            type: String,
            default: null,
            trim: true,
        },
        balance_before: {
            type: Number,
            required: [true, "balance_before is required"],
            min: [0, "balance_before cannot be negative"],
        },
        balance_after: {
            type: Number,
            required: [true, "balance_after is required"],
            min: [0, "balance_after cannot be negative"],
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
        collection: "wallet_transactions",
    }
);

walletTransactionSchema.index({ wallet_id: 1, created_at: -1 });
walletTransactionSchema.index({ wallet_id: 1, type: 1, created_at: -1 });
walletTransactionSchema.index(
    { type: 1, reference_id: 1 },
    {
        unique: true,
        partialFilterExpression: {
            type: "TOPUP",
            reference_id: { $type: "string" },
        },
        name: "uniq_wallet_topup_reference",
    }
);

const WalletTransaction = mongoose.model("WalletTransaction", walletTransactionSchema);

module.exports = WalletTransaction;
