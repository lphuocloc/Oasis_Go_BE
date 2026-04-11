const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const INCIDENT_DETAIL_TYPES = ["ITEM", "SERVICE"];

const incidentDetailSchema = new mongoose.Schema(
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
    type: {
      type: String,
      required: [true, "type is required"],
      enum: {
        values: INCIDENT_DETAIL_TYPES,
        message: "{VALUE} is not a valid incident detail type",
      },
      index: true,
    },
    item_id: {
      type: String,
      default: null,
      ref: "Item",
      index: true,
    },
    service_catalog_id: {
      type: String,
      default: null,
      ref: "DamageServiceCatalog",
      index: true,
    },
    name_snapshot: {
      type: String,
      default: null,
      trim: true,
    },
    unit_cost_snapshot: {
      type: Number,
      default: 0,
      min: 0,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    total_cost: {
      type: Number,
      default: 0,
      min: 0,
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

incidentDetailSchema.index({ incident_id: 1, created_at: -1 });
incidentDetailSchema.index({ type: 1, created_at: -1 });
incidentDetailSchema.index({ item_id: 1, created_at: -1 });
incidentDetailSchema.index({ service_catalog_id: 1, created_at: -1 });

module.exports = mongoose.model("IncidentDetail", incidentDetailSchema);
