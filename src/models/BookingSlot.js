const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingSlotSchema = new mongoose.Schema(
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
            index: true,
        },
        time_slot_id: {
            type: String,
            required: [true, "Time slot ID is required"],
            ref: "TimeSlot",
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for unique booking-timeslot pairs
bookingSlotSchema.index({ booking_id: 1, time_slot_id: 1 }, { unique: true });

// Virtual for booking details
bookingSlotSchema.virtual("booking", {
    ref: "Booking",
    localField: "booking_id",
    foreignField: "id",
    justOne: true,
});

// Virtual for time slot details
bookingSlotSchema.virtual("timeSlot", {
    ref: "TimeSlot",
    localField: "time_slot_id",
    foreignField: "id",
    justOne: true,
});

// Enable virtuals in JSON
bookingSlotSchema.set("toJSON", { virtuals: true });
bookingSlotSchema.set("toObject", { virtuals: true });

// Static method to get slots by booking
bookingSlotSchema.statics.getByBooking = async function (bookingId) {
    return await this.find({ booking_id: bookingId })
        .populate("timeSlot", "id pod_id start_time end_time status")
        .sort({ createdAt: 1 });
};

// Static method to get bookings by time slot
bookingSlotSchema.statics.getByTimeSlot = async function (timeSlotId) {
    return await this.find({ time_slot_id: timeSlotId })
        .populate("booking", "id order_id user_id pod_id status")
        .sort({ createdAt: 1 });
};

// Static method to check if slot is already booked
bookingSlotSchema.statics.isSlotBooked = async function (timeSlotId) {
    const existingSlot = await this.findOne({ time_slot_id: timeSlotId });
    return !!existingSlot;
};

// Static method to bulk create slots for a booking
bookingSlotSchema.statics.createBulkSlots = async function (bookingId, timeSlotIds) {
    const slots = timeSlotIds.map((timeSlotId) => ({
        booking_id: bookingId,
        time_slot_id: timeSlotId,
    }));

    return await this.insertMany(slots);
};

// Static method to delete all slots for a booking
bookingSlotSchema.statics.deleteByBooking = async function (bookingId) {
    return await this.deleteMany({ booking_id: bookingId });
};

module.exports = mongoose.model("BookingSlot", bookingSlotSchema);
