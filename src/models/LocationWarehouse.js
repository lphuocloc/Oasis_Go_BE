const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const locationWarehouseSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    location_id: {
      type: String,
      required: [true, "Location ID is required"],
      ref: "Location",
      index: true,
    },
    warehouse_id: {
      type: String,
      required: [true, "Warehouse ID is required"],
      ref: "Warehouse",
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

locationWarehouseSchema.index({ location_id: 1, warehouse_id: 1 }, { unique: true });

module.exports = mongoose.model("LocationWarehouse", locationWarehouseSchema);
