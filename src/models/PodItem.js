const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
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
    expected_quantity: {
      type: Number,
      required: true,
      min: [0, "Expected quantity cannot be negative"],
      default: 0,
    },
    current_quantity: {
      type: Number,
      required: true,
      min: [0, "Current quantity cannot be negative"],
      default: 0,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

podItemSchema.index({ pod_id: 1, item_id: 1 }, { unique: true });

podItemSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("PodItem", podItemSchema);
