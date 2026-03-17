const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const inventoryCheckoutLogSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    inventory_stock_id: {
      type: String,
      required: [true, "Inventory stock ID is required"],
      ref: "InventoryStock",
      index: true,
    },
    staff_id: {
      type: String,
      required: [true, "Staff ID is required"],
      ref: "User",
      index: true,
    },
    cleaning_task_id: {
      type: String,
      default: null,
    },
    maintenance_task_id: {
      type: String,
      default: null,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be greater than 0"],
    },
    action_type: {
      type: String,
      required: [true, "Action type is required"],
      enum: {
        values: ["CHECKOUT", "RETURN", "WASTE"],
        message: "{VALUE} is not a valid action type",
      },
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("InventoryCheckoutLog", inventoryCheckoutLogSchema);
