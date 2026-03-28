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
        values: ["CLEANING", "MAINTENANCE", "OTHERS"],
        message: "{VALUE} is not a valid support request type",
      },
      required: true,
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
        values: ["PENDING", "IN_PROGRESS", "RESOLVED"],
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
