const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const cleaningMediaSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    cleaning_task_id: {
      type: String,
      required: [true, "cleaning_task_id is required"],
      ref: "CleaningTask",
      index: true,
    },
    media_url: {
      type: String,
      required: [true, "media_url is required"],
      trim: true,
    },
    media_public_id: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    media_type: {
      type: String,
      required: true,
      enum: {
        values: ["BEFORE", "AFTER"],
        message: "{VALUE} is not a valid media_type",
      },
      index: true,
    },
    file_type: {
      type: String,
      required: true,
      default: "IMAGE",
      enum: {
        values: ["IMAGE", "VIDEO"],
        message: "{VALUE} is not a valid file_type",
      },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

cleaningMediaSchema.index({ cleaning_task_id: 1, created_at: -1 });

module.exports = mongoose.model("CleaningMedia", cleaningMediaSchema);
