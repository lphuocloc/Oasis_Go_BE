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
        checkin_source: {
            type: String,
            enum: {
                values: ["MANUAL", "AUTO"],
                message: "{VALUE} is not a valid checkin_source",
            },
            default: "MANUAL",
            trim: true,
        },
        access_reason: {
            type: String,
            enum: {
                values: ["BOOKING", "CLEANER_ACCESS", "MANAGER_OVERRIDE"],
                message: "{VALUE} is not a valid access_reason",
            },
            default: "BOOKING",
            trim: true,
        },
        key_type: {
            type: String,
            enum: {
                values: ["CUSTOMER", "CLEANER", "SYSTEM"],
                message: "{VALUE} is not a valid key_type",
            },
            default: "CUSTOMER",
            trim: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes for faster queries
bookingAccessSessionSchema.index({ booking_id: 1 });
bookingAccessSessionSchema.index({ pod_id: 1 });
bookingAccessSessionSchema.index({ user_id: 1 });
bookingAccessSessionSchema.index({ checkin_at: 1 });
bookingAccessSessionSchema.index({ checkout_at: 1 });
bookingAccessSessionSchema.index({ access_reason: 1 });
bookingAccessSessionSchema.index({ checkin_source: 1 });

// Virtual field to calculate access duration in minutes
bookingAccessSessionSchema.virtual("access_duration_minutes").get(function () {
    if (!this.checkin_at || !this.checkout_at) {
        return null;
    }
    const durationMs = this.checkout_at.getTime() - this.checkin_at.getTime();
    return Math.floor(durationMs / 60000); // Convert ms to minutes
});

const BookingAccessSession = mongoose.model("BookingAccessSession", bookingAccessSessionSchema);

module.exports = BookingAccessSession;
