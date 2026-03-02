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
      index: true,
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
bookingSchema.pre("save", function (next) {
  if (this.end_time <= this.start_time) {
    return next(new Error("End time must be after start time"));
  }
  next();
});

// Instance method to start using pod
bookingSchema.methods.startUsing = async function () {
  if (this.status !== "BOOKED") {
    throw new Error(`Cannot start using from ${this.status} status`);
  }
  this.status = "IN_USE";
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