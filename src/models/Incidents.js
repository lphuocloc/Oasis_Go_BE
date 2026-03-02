const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema(
  {
    podId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pod",
      required: true,
      index: true,
    },

    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
    },

    status: {
      type: String,
      enum: ["PENDING", "INVESTIGATING", "RESOLVED", "CLOSED"],
      default: "PENDING",
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("Incident", incidentSchema);