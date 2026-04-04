const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const supportRequestSchema = new mongoose.Schema(
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
    location_id: {
      type: String,
      required: [true, "Location ID is required"],
      ref: "Location",
      index: true,
    },
    user_id: {
      type: String,
      required: [true, "User ID is required"],
      ref: "User",
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ["MAINTENANCE", "CHANGE_POD"],
        message: "{VALUE} is not a valid support request type",
      },
      required: true,
      index: true,
    },
    severity: {
      type: String,
      default: null,
      enum: {
        values: ["LOW", "MEDIUM", "HIGH", "CRITICAL", null],
        message: "{VALUE} is not a valid severity",
      },
      index: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["PENDING", "PROCESSING", "IN_PROGRESS", "ESCALATED", "RESOLVED", "REJECTED"],
        message: "{VALUE} is not a valid support request status",
      },
      default: "PENDING",
      required: true,
      index: true,
    },
    images: {
      type: [String],
      default: [],
    },
    handled_by: {
      type: String,
      default: null,
      ref: "User",
      index: true,
    },
    handled_at: {
      type: Date,
      default: null,
    },
    escalation_note: {
      type: String,
      default: null,
      trim: true,
    },
    resolution_note: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

supportRequestSchema.index({ user_id: 1, status: 1, createdAt: -1 });
supportRequestSchema.index({ booking_id: 1, createdAt: -1 });
supportRequestSchema.index({ location_id: 1, status: 1, createdAt: -1 });
supportRequestSchema.index({ pod_id: 1, status: 1, createdAt: -1 });
supportRequestSchema.index(
  { booking_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["PENDING", "PROCESSING"] },
    },
    name: "uniq_active_support_request_per_booking",
  }
);

supportRequestSchema.virtual("booking", {
  ref: "Booking",
  localField: "booking_id",
  foreignField: "id",
  justOne: true,
});

supportRequestSchema.virtual("user", {
  ref: "User",
  localField: "user_id",
  foreignField: "_id",
  justOne: true,
});

supportRequestSchema.virtual("handler", {
  ref: "User",
  localField: "handled_by",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("SupportRequest", supportRequestSchema);
