const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    order_id: {
      type: String,
      required: [true, "Order ID is required"],
      ref: "BookingOrder",
      index: true,
    },
    user_id: {
      type: String,
      required: [true, "User ID is required"],
      ref: "User",
      index: true,
    },
    pod_id: {
      type: String,
      required: [true, "Pod ID is required"],
      ref: "Pod",
    },
    start_time: {
      type: Date,
      required: [true, "Start time is required"],
      index: true,
    },
    end_time: {
      type: Date,
      required: [true, "End time is required"],
      index: true,
    },
    actual_end_time: {
      type: Date,
      default: null,
    },
    cleaner_access_allowed: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },
    cleaner_access_updated_at: {
      type: Date,
      default: null,
    },
    checkin_state: {
      type: String,
      enum: {
        values: ["PENDING", "MANUAL_CHECKED_IN", "AUTO_ACTIVATED", "NO_SHOW"],
        message: "{VALUE} is not a valid checkin_state",
      },
      default: "PENDING",
      required: true,
      index: true,
    },
    checked_in_at: {
      type: Date,
      default: null,
    },
    checkin_source: {
      type: String,
      enum: {
        values: ["USER_QR", "SYSTEM_AUTO", null],
        message: "{VALUE} is not a valid checkin_source",
      },
      default: null,
    },
    auto_activated_at: {
      type: Date,
      default: null,
    },
    no_show_marked_at: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ["BOOKED", "IN_USE", "COMPLETED", "CANCELLED"],
        message: "{VALUE} is not a valid status",
      },
      default: "BOOKED",
      required: true,
      index: true,
    },
    base_price: {
      type: Number,
      required: [true, "Base price is required"],
      min: [0, "Base price cannot be negative"],
    },
    total_price: {
      type: Number,
      required: [true, "Total price is required"],
      min: [0, "Total price cannot be negative"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
bookingSchema.index({ user_id: 1, status: 1 });
bookingSchema.index({ pod_id: 1, start_time: 1 });
bookingSchema.index({ status: 1, created_at: -1 });
bookingSchema.index({ status: 1, checkin_state: 1, start_time: 1 });

// Virtual for order details
bookingSchema.virtual("order", {
  ref: "BookingOrder",
  localField: "order_id",
  foreignField: "id",
  justOne: true,
});

// Virtual for user details
bookingSchema.virtual("user", {
  ref: "User",
  localField: "user_id",
  foreignField: "id",
  justOne: true,
});

// Virtual for pod details
bookingSchema.virtual("pod", {
  ref: "Pod",
  localField: "pod_id",
  foreignField: "id",
  justOne: true,
});

// Pre-save validation: end_time must be after start_time
bookingSchema.pre("save", async function () {
  if (this.end_time <= this.start_time) {
    throw new Error("End time must be after start time");
  }
});

// Instance method to start using pod
bookingSchema.methods.startUsing = async function () {
  if (this.status !== "BOOKED") {
    throw new Error(`Cannot start using from ${this.status} status`);
  }

  const CHECKIN_GRACE_PERIOD_MS = 15 * 60 * 1000;
  const now = Date.now();
  const startWindow = new Date(this.start_time).getTime() - CHECKIN_GRACE_PERIOD_MS;
  const endWindow = new Date(this.start_time).getTime() + CHECKIN_GRACE_PERIOD_MS;

  if (now < startWindow || now > endWindow) {
    throw new Error("Check-in is only allowed from 15 minutes before start_time to 15 minutes after start_time");
  }

  this.status = "IN_USE";
  this.checkin_state = "MANUAL_CHECKED_IN";
  this.checked_in_at = new Date();
  this.checkin_source = "USER_QR";
  this.no_show_marked_at = null;
  await this.save();
  return this;
};

// Instance method to complete booking
bookingSchema.methods.complete = async function (actualEndTime = null) {
  if (this.status !== "IN_USE") {
    throw new Error("Can only complete bookings that are in use");
  }
  this.status = "COMPLETED";
  this.actual_end_time = actualEndTime || new Date();
  await this.save();
  return this;
};

// Instance method to cancel booking
bookingSchema.methods.cancel = async function () {
  if (this.status === "COMPLETED") {
    throw new Error("Cannot cancel completed booking");
  }
  if (this.status === "CANCELLED") {
    throw new Error("Booking is already cancelled");
  }
  this.status = "CANCELLED";
  this.checkin_state = "PENDING";
  this.checked_in_at = null;
  this.checkin_source = null;
  this.auto_activated_at = null;
  this.no_show_marked_at = null;
  await this.save();
  return this;
};

// Static method to get bookings by user
bookingSchema.statics.getByUser = async function (userId, status = null) {
  const filter = { user_id: userId };
  if (status) filter.status = status;
  return await this.find(filter).sort({ created_at: -1 });
};

// Static method to get bookings by pod
bookingSchema.statics.getByPod = async function (podId, status = null) {
  const filter = { pod_id: podId };
  if (status) filter.status = status;
  return await this.find(filter).sort({ start_time: 1 });
};

// Static method to get bookings by order
bookingSchema.statics.getByOrder = async function (orderId) {
  return await this.find({ order_id: orderId }).sort({ start_time: 1 });
};

// Static method to check pod availability
bookingSchema.statics.isPodAvailable = async function (podId, startTime, endTime, excludeBookingId = null) {
  const query = {
    pod_id: podId,
    status: { $in: ["BOOKED", "IN_USE"] },
    $or: [
      {
        start_time: { $lt: new Date(endTime) },
        end_time: { $gt: new Date(startTime) }
      }
    ]
  };

  if (excludeBookingId) {
    query.id = { $ne: excludeBookingId };
  }

  const conflictingBooking = await this.findOne(query);
  return !conflictingBooking;
};

module.exports = mongoose.model("Booking", bookingSchema);