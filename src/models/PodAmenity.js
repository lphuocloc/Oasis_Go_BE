const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podAmenitySchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: [true, "Amenity name is required"],
      trim: true,
    },
    value: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

podAmenitySchema.index({ pod_id: 1, name: 1 });

module.exports = mongoose.model("PodAmenity", podAmenitySchema);
