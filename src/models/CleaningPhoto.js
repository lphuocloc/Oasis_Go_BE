const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const cleaningPhotoSchema = new mongoose.Schema(
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
    photo_url: {
      type: String,
      required: [true, "photo_url is required"],
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: {
        values: ["BEFORE", "AFTER"],
        message: "{VALUE} is not a valid type",
      },
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

cleaningPhotoSchema.index({ cleaning_task_id: 1, created_at: -1 });

module.exports = mongoose.model("CleaningPhoto", cleaningPhotoSchema);
