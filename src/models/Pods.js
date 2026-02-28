const mongoose = require("mongoose");

const podSchema = new mongoose.Schema(
  {
    clusterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PodCluster",
      required: true,
    },

    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
    },

    status: {
      type: String,
      enum: [
        "AVAILABLE",
        "OCCUPIED",
        "NEEDS_CLEANING",
        "CLEANING",
        "MAINTENANCE",
        "OUT_OF_SERVICE",
      ],
      default: "AVAILABLE",
      index: true,
    },

    maintenanceStatus: {
      type: String,
    },

    soundproofLevel: {
      type: Number,
    },

    ventilationLevel: {
      type: Number,
    },

    powerOutlets: {
      type: Number,
      default: 1,
    },

    wifiAvailable: {
      type: Boolean,
      default: true,
    },

    maxSessionDuration: {
      type: Number, // minutes
    },

    lastCleanedAt: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("Pod", podSchema);