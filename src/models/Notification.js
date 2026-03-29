const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_EVENT_CODES,
  DELIVERY_STATUSES,
} = require("../constants/notificationConstants");

const notificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    user_id: {
      type: String,
      required: [true, "User ID is required"],
      ref: "User",
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [255, "Title cannot exceed 255 characters"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: "{VALUE} is not a valid notification type",
      },
      required: true,
      index: true,
    },
    event_code: {
      type: String,
      enum: {
        values: NOTIFICATION_EVENT_CODES,
        message: "{VALUE} is not a valid event code",
      },
      required: true,
      index: true,
    },
    is_read: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },
    read_at: {
      type: Date,
      default: null,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    delivery_status: {
      type: String,
      enum: {
        values: DELIVERY_STATUSES,
        message: "{VALUE} is not a valid delivery status",
      },
      default: "PENDING",
      required: true,
      index: true,
    },
    sent_at: {
      type: Date,
      default: null,
    },
    failure_reason: {
      type: String,
      default: null,
      maxlength: [1000, "Failure reason cannot exceed 1000 characters"],
    },
    dedupe_key: {
      type: String,
      default: null,
      trim: true,
      maxlength: [255, "Dedupe key cannot exceed 255 characters"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

notificationSchema.index({ user_id: 1, createdAt: -1 });
notificationSchema.index({ user_id: 1, is_read: 1, createdAt: -1 });
notificationSchema.index({ user_id: 1, type: 1, createdAt: -1 });
notificationSchema.index({ user_id: 1, event_code: 1, createdAt: -1 });
notificationSchema.index(
  { user_id: 1, dedupe_key: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupe_key: { $type: "string" } },
    name: "uniq_notification_dedupe_per_user",
  }
);

notificationSchema.pre("save", function () {
  if (this.isModified("is_read")) {
    this.read_at = this.is_read ? new Date() : null;
  }

  if (this.isModified("delivery_status")) {
    this.sent_at = this.delivery_status === "SENT" ? new Date() : this.sent_at;
  }
});

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_EVENT_CODES = NOTIFICATION_EVENT_CODES;
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
