const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const itemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    name: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
    },
    item_type: {
      type: String,
      enum: {
        values: ["CONSUMABLE", "REUSABLE"],
        message: "{VALUE} is not a valid item type",
      },
      required: true,
      default: "CONSUMABLE",
    },
    unit_cost: {
      type: Number,
      default: 0,
      min: [0, "Unit cost cannot be negative"],
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("Item", itemSchema);
