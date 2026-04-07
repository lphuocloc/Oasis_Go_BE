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
    incident_type: {
      type: String,
      enum: {
        values: ["OPERATIONAL", "DAMAGE_REPORT"],
        message: "{VALUE} is not a valid incident type",
      },
      default: "OPERATIONAL",
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
    reported_by: {
      type: String,
      required: [true, "reported_by is required"],
      ref: "User",
      index: true,
    },
    handled_by: {
      type: String,
      default: null,
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
        values: ["PENDING", "RESOLVED", "DISMISSED"],
        message: "{VALUE} is not a valid status",
      },
      default: "PENDING",
      index: true,
    },
    estimated_service_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimated_total_value: {
      type: Number,
      default: null,
      min: 0,
    },
    pricing_source: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

incidentSchema.index({ reported_by: 1, created_at: -1 });
incidentSchema.index({ handled_by: 1, created_at: -1 });
incidentSchema.index({ cleaning_task_id: 1, created_at: -1 });
incidentSchema.index({ incident_type: 1, created_at: -1 });

module.exports = mongoose.model("Incident", incidentSchema);