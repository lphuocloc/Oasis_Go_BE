const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const cleaningBufferPolicySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    location_id: {
      type: String,
      default: null,
      index: true,
    },
    cluster_id: {
      type: String,
      default: null,
      index: true,
    },
    pod_id: {
      type: String,
      default: null,
      index: true,
    },
    buffer_minutes: {
      type: Number,
      required: [true, "buffer_minutes is required"],
      min: [0, "buffer_minutes must be >= 0"],
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("CleaningBufferPolicy", cleaningBufferPolicySchema);
