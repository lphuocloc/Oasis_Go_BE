const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const inventoryStockSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    warehouse_id: {
      type: String,
      required: [true, "Warehouse ID is required"],
      ref: "Warehouse",
      index: true,
    },
    item_id: {
      type: String,
      required: [true, "Item ID is required"],
      ref: "Item",
      index: true,
    },
    quantity_available: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Quantity available cannot be negative"],
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

inventoryStockSchema.index({ warehouse_id: 1, item_id: 1 }, { unique: true });

inventoryStockSchema.pre("save", async function () {
  this.updated_at = new Date();
});

module.exports = mongoose.model("InventoryStock", inventoryStockSchema);
