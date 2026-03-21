const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const maintenanceTaskSchema = new mongoose.Schema(
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
    reported_by: {
      type: String,
      required: [true, "reported_by is required"],
      ref: "User",
      index: true,
    },
    shift_assignment_id: {
      type: String,
      default: null,
      ref: "StaffShiftAssignment",
      index: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      default: "PENDING",
      enum: {
        values: ["PENDING", "IN_PROGRESS", "RESOLVED", "CLOSED"],
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

maintenanceTaskSchema.index({ reported_by: 1, created_at: -1 });
maintenanceTaskSchema.index({ shift_assignment_id: 1, created_at: -1 });

module.exports = mongoose.model("MaintenanceTask", maintenanceTaskSchema);
