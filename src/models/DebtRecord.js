const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const debtRecordSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
      index: true,
    },
    user_id: {
      type: String,
      required: [true, "user_id is required"],
      index: true,
      ref: "User",
    },
    order_id: {
      type: String,
      required: [true, "order_id is required"],
      unique: true,
      index: true,
      ref: "BookingOrder",
    },
    incident_ids: {
      type: [String],
      default: [],
    },
    principal_amount: {
      type: Number,
      required: true,
      min: [0, "principal_amount cannot be negative"],
      default: 0,
    },
    remaining_amount: {
      type: Number,
      required: true,
      min: [0, "remaining_amount cannot be negative"],
      default: 0,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ["ACTIVE", "SETTLED", "WRITEOFF"],
        message: "{VALUE} is not a valid debt status",
      },
      default: "ACTIVE",
      index: true,
    },
    aging_bucket: {
      type: String,
      enum: {
        values: ["LT_7", "D7_D30", "GT_30", "BLACKLISTED"],
        message: "{VALUE} is not a valid aging bucket",
      },
      default: "LT_7",
      index: true,
    },
    due_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    settled_at: {
      type: Date,
      default: null,
    },
    last_reminder_at: {
      type: Date,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

debtRecordSchema.index({ user_id: 1, status: 1, remaining_amount: -1 });
debtRecordSchema.index({ status: 1, due_at: 1, last_reminder_at: 1 });

module.exports = mongoose.model("DebtRecord", debtRecordSchema);
