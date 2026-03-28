const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const incidentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    pod_id: {
      type: String,
      required: [true, "pod_id is required"],
      ref: "Pod",
      index: true,
    },
    booking_id: {
      type: String,
      default: null,
      ref: "Booking",
      index: true,
    },
    cleaning_task_id: {
      type: String,
      default: null,
      ref: "CleaningTask",
      index: true,
    },
    shift_assignment_id: {
      type: String,
      default: null,
      ref: "StaffShiftAssignment",
      index: true,
    },
    reported_by: {
      type: String,
      required: [true, "reported_by is required"],
      ref: "User",
      index: true,
    },
    description: {
      type: String,
      required: [true, "description is required"],
      trim: true,
    },
    severity: {
      type: String,
      enum: {
        values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        message: "{VALUE} is not a valid severity",
      },
      default: "MEDIUM",
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ["PENDING", "INVESTIGATING", "RESOLVED", "CLOSED"],
        message: "{VALUE} is not a valid status",
      },
      default: "PENDING",
      index: true,
    },
    has_lost_found: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

incidentSchema.index({ reported_by: 1, created_at: -1 });
incidentSchema.index({ cleaning_task_id: 1, created_at: -1 });

module.exports = mongoose.model("Incident", incidentSchema);