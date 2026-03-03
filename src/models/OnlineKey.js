const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const onlineKeySchema = new mongoose.Schema(
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
        },
        pod_id: {
            type: String,
            required: [true, "Pod ID is required"],
            ref: "Pod",
        },
        user_id: {
            type: String,
            required: [true, "User ID is required"],
            ref: "User",
        },
        key_type: {
            type: String,
            enum: {
                values: ["CUSTOMER", "CLEANER", "MANAGER"],
                message: "{VALUE} is not a valid key type",
            },
            required: true,
            trim: true,
        },
        key_token: {
            type: String,
            required: [true, "Key token is required"],
            trim: true,
        },
        valid_from: {
            type: Date,
            required: [true, "Valid from date is required"],
        },
        valid_to: {
            type: Date,
            required: [true, "Valid to date is required"],
        },
        is_revoked: {
            type: Boolean,
            default: false,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for faster queries
onlineKeySchema.index({ booking_id: 1 });
onlineKeySchema.index({ pod_id: 1 });
onlineKeySchema.index({ user_id: 1 });
onlineKeySchema.index({ key_token: 1 });
onlineKeySchema.index({ key_type: 1 });
onlineKeySchema.index({ valid_from: 1, valid_to: 1 });
onlineKeySchema.index({ is_revoked: 1 });

const OnlineKey = mongoose.model("OnlineKey", onlineKeySchema);

module.exports = OnlineKey;
