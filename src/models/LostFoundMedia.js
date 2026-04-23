const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const lostFoundMediaSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    lost_found_item_id: {
      type: String,
      required: [true, "lost_found_item_id is required"],
      ref: "LostFoundItem",
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

lostFoundMediaSchema.index({ lost_found_item_id: 1, created_at: -1 });

module.exports = mongoose.model("LostFoundMedia", lostFoundMediaSchema);
