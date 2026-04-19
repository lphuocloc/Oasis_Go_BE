const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const normalizeTaskId = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const inventoryActivityLogSchema = new mongoose.Schema(
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
    actor_id: {
      type: String,
      default: null,
      ref: "User",
      index: true,
    },
    cleaning_task_id: {
      type: String,
      default: null,
      set: normalizeTaskId,
    },
    maintenance_task_id: {
      type: String,
      default: null,
      set: normalizeTaskId,
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
        values: ["CHECKOUT", "RETURN", "WASTE", "INITIAL", "ADJUSTMENT"],
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

inventoryActivityLogSchema.pre("validate", function () {
  const hasCleaningTask = Boolean(this.cleaning_task_id);
  const hasMaintenanceTask = Boolean(this.maintenance_task_id);

  if (hasCleaningTask && hasMaintenanceTask) {
    this.invalidate(
      "cleaning_task_id",
      "Only one of cleaning_task_id or maintenance_task_id can be provided"
    );
    this.invalidate(
      "maintenance_task_id",
      "Only one of cleaning_task_id or maintenance_task_id can be provided"
    );
  }

  if (this.action_type === "WASTE" && !this.reason) {
    this.invalidate("reason", "reason is required when action_type is WASTE");
  }
});

inventoryActivityLogSchema.index({ created_at: -1 });
inventoryActivityLogSchema.index({ inventory_stock_id: 1, created_at: -1 });
inventoryActivityLogSchema.index({ staff_id: 1, created_at: -1 });
inventoryActivityLogSchema.index({ actor_id: 1, created_at: -1 });

module.exports = mongoose.model("InventoryActivityLog", inventoryActivityLogSchema);
