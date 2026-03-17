const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const warehouseSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    name: {
      type: String,
      required: [true, "Warehouse name is required"],
      trim: true,
    },
    address: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

warehouseSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("Warehouse", warehouseSchema);
