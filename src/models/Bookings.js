const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingOrder",
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    podId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pod",
      required: true,
      index: true,
    },

    startTime: {
      type: Date,
      required: true,
      index: true,
    },

    endTime: {
      type: Date,
      required: true,
      index: true,
    },

    actualEndTime: {
      type: Date,
    },

    status: {
      type: String,
      enum: ["BOOKED", "IN_USE", "COMPLETED", "CANCELLED"],
      default: "BOOKED",
      index: true,
    },

    basePrice: {
      type: Number,
      required: true,
    },

    totalPrice: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("Booking", bookingSchema);