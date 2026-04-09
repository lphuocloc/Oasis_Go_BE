const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const SERVICE_CATEGORIES = ["CONSTRUCTION", "CLEANING", "PENALTY"];

const damageServiceCatalogSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    name: {
      type: String,
      required: [true, "name is required"],
      trim: true,
    },
    category: {
      type: String,
      default: null,
      enum: {
        values: SERVICE_CATEGORIES,
        message: "{VALUE} is not a valid service category",
      },
      index: true,
    },
    base_price: {
      type: Number,
      default: 0,
      min: 0,
    },
    unit_name: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
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

damageServiceCatalogSchema.index({ name: 1, is_active: 1 });

module.exports = mongoose.model("DamageServiceCatalog", damageServiceCatalogSchema);
