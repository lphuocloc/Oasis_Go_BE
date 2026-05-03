const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const REPORTED_STATUSES = ["MATCHED", "DAMAGED", "MISSING", "MATCHED_BY_SYSTEM"];
const CONFIRMED_BY = ["USER", "SYSTEM", "CLEANER"];

const bookingChecklistSchema = new mongoose.Schema(
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
    pod_id: {
      type: String,
      required: [true, "Pod ID is required"],
      ref: "Pod",
      index: true,
    },
    item_id: {
      type: String,
      required: [true, "Item ID is required"],
      ref: "Item",
      index: true,
    },
    item_name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: {
        values: ["REPLENISHMENT_REQUEST", "DAMAGE_REPORT"],
        message: "{VALUE} is not a valid checklist type",
      },
      default: "REPLENISHMENT_REQUEST",
      required: true,
    },
    expected_quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    reported_status: {
      type: String,
      enum: {
        values: REPORTED_STATUSES,
        message: "{VALUE} is not a valid reported status",
      },
      required: true,
    },
    reported_quantity: {
      type: Number,
      min: 0,
      default: 0,
    },

    incident_id: {
      type: String,
      default: null,
      ref: "Incident",
    },
    confirmed_by: {
      type: String,
      enum: {
        values: CONFIRMED_BY,
        message: "{VALUE} is not a valid confirmed_by value",
      },
      required: true,
    },
    confirmed_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

bookingChecklistSchema.index({ booking_id: 1, item_id: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("BookingChecklist", bookingChecklistSchema);
