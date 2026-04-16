const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const LOST_FOUND_STATUSES = ["FOUND", "CLAIMED", "DISPOSED", "RETURNED_TO_USER"];

const lostFoundItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    pod_id: {
      type: String,
      default: null,
      ref: "Pod",
      index: true,
    },
    booking_id: {
      type: String,
      default: null,
      ref: "Booking",
      index: true,
    },
    found_by_user_id: {
      type: String,
      required: [true, "found_by_user_id is required"],
      ref: "User",
      index: true,
    },
    warehouse_id: {
      type: String,
      default: null,
      ref: "Warehouse",
      index: true,
    },
    item_name: {
      type: String,
      required: [true, "item_name is required"],
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    photo_url: {
      type: String,
      default: null,
    },
    found_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      required: true,
      default: "FOUND",
      enum: {
        values: LOST_FOUND_STATUSES,
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
    claimed_by_user_id: {
      type: String,
      default: null,
      ref: "User",
      index: true,
    },
    claimed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

lostFoundItemSchema.index({ pod_id: 1, created_at: -1 });
lostFoundItemSchema.index({ booking_id: 1, created_at: -1 });
lostFoundItemSchema.index({ found_by_user_id: 1, created_at: -1 });

module.exports = mongoose.model("LostFoundItem", lostFoundItemSchema);
