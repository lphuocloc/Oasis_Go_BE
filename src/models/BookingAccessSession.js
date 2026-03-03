const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingAccessSessionSchema = new mongoose.Schema(
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
        checkin_at: {
            type: Date,
            default: null,
        },
        checkout_at: {
            type: Date,
            default: null,
        },
        checkout_type: {
            type: String,
            enum: {
                values: ["NORMAL", "EARLY", "TIMEOUT"],
                message: "{VALUE} is not a valid checkout type",
            },
            default: null,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for faster queries
bookingAccessSessionSchema.index({ booking_id: 1 });
bookingAccessSessionSchema.index({ pod_id: 1 });
bookingAccessSessionSchema.index({ user_id: 1 });
bookingAccessSessionSchema.index({ checkin_at: 1 });
bookingAccessSessionSchema.index({ checkout_at: 1 });

const BookingAccessSession = mongoose.model("BookingAccessSession", bookingAccessSessionSchema);

module.exports = BookingAccessSession;
