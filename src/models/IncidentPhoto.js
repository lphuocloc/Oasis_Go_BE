const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const incidentPhotoSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    incident_id: {
      type: String,
      required: [true, "incident_id is required"],
      ref: "Incident",
      index: true,
    },
    photo_url: {
      type: String,
      required: [true, "photo_url is required"],
      trim: true,
    },
    photo_public_id: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: "uploaded_at", updatedAt: false },
  }
);

incidentPhotoSchema.index({ incident_id: 1, uploaded_at: -1 });

module.exports = mongoose.model("IncidentPhoto", incidentPhotoSchema);
