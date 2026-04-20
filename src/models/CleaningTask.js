const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const CLEANING_TASK_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "MISSED",
];

const CLEANING_REQUEST_SOURCES = [
  "USER_REQUEST",
  "AUTO_AFTER_CHECKOUT",
  "SYSTEM_RETRY",
  "ROOM_CHANGE_VACATED",
];

const cleaningTaskSchema = new mongoose.Schema(
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
    booking_id: {
      type: String,
      default: null,
      ref: "Booking",
      index: true,
    },
    cleaner_id: {
      type: String,
      required: [true, "Cleaner ID is required"],
      ref: "User",
      index: true,
    },
    shift_assignment_id: {
      type: String,
      default: null,
      ref: "StaffShiftAssignment",
      index: true,
    },
    request_source: {
      type: String,
      default: "USER_REQUEST",
      enum: {
        values: CLEANING_REQUEST_SOURCES,
        message: "{VALUE} is not a valid request_source",
      },
      index: true,
    },
    estimated_start_time: {
      type: Date,
      default: null,
      index: true,
    },
    due_at: {
      type: Date,
      default: null,
      index: true,
    },
    assigned_at: {
      type: Date,
      default: null,
    },
    notified_at: {
      type: Date,
      default: null,
    },
    accepted_at: {
      type: Date,
      default: null,
    },
    start_time: {
      type: Date,
      default: null,
    },
    end_time: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      required: true,
      default: "ASSIGNED",
      enum: {
        values: CLEANING_TASK_STATUSES,
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
    rejection_reason: {
      type: String,
      default: null,
      trim: true,
    },
    reassigned_from_cleaner_id: {
      type: String,
      default: null,
      ref: "User",
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

cleaningTaskSchema.index({ cleaner_id: 1, created_at: -1 });
cleaningTaskSchema.index({ shift_assignment_id: 1, created_at: -1 });
cleaningTaskSchema.index({ cleaner_id: 1, status: 1, due_at: 1 });
cleaningTaskSchema.index({ shift_assignment_id: 1, status: 1 });
cleaningTaskSchema.index({ pod_id: 1, created_at: -1 });
cleaningTaskSchema.index({ booking_id: 1, created_at: -1 });

module.exports = mongoose.model("CleaningTask", cleaningTaskSchema);
