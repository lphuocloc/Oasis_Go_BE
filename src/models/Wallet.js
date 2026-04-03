const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const walletSchema = new mongoose.Schema(
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
            unique: true,
            index: true,
            ref: "User",
        },
        balance: {
            type: Number,
            default: 0,
            min: [0, "Balance cannot be negative"],
            required: true,
        },
        // Store PIN hash as string because hash outputs are not numeric values.
        pincode_hash: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: {
                values: ["ACTIVE", "LOCKED"],
                message: "{VALUE} is not a valid wallet status",
            },
            default: "ACTIVE",
            required: true,
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

walletSchema.pre("save", function () {
    this.updated_at = new Date();
});

walletSchema.index({ status: 1, updated_at: -1 });

module.exports = mongoose.model("Wallet", walletSchema);