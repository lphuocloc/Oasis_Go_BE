const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const depositPolicySchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        policy_key: {
            type: String,
            required: true,
            unique: true,
            default: "VOLUME_BASED_DEPOSIT_GLOBAL",
            trim: true,
        },
        tier_1_price: {
            type: Number,
            required: true,
            min: 0,
            default: 500000,
        },
        tier_2_price: {
            type: Number,
            required: true,
            min: 0,
            default: 400000,
        },
        tier_3_price: {
            type: Number,
            required: true,
            min: 0,
            default: 300000,
        },
        updated_by: {
            type: String,
            default: null,
            index: true,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

module.exports = mongoose.model("DepositPolicy", depositPolicySchema);
