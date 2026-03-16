const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podDeviceSchema = new mongoose.Schema(
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
      unique: true,
      index: true,
    },
    device_name: {
      type: String,
      required: [true, "Device name is required"],
      trim: true,
    },
    device_id: {
      type: String,
      required: [true, "Device ID is required"],
      unique: true,
      trim: true,
    },
    auth_token: {
      type: String,
      default: null,
      trim: true,
    },
    is_online: {
      type: Boolean,
      default: false,
    },
    last_ping: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PodDevice", podDeviceSchema);
