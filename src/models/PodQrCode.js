const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podQrCodeSchema = new mongoose.Schema(
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
    qr_token: {
      type: String,
      required: [true, "QR token is required"],
      unique: true,
      trim: true,
    },
    expires_at: {
      type: Date,
      required: [true, "Expiry time is required"],
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

podQrCodeSchema.index({ pod_id: 1, is_active: 1 });

module.exports = mongoose.model("PodQrCode", podQrCodeSchema);
