const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

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
        values: ["ASSIGNED", "IN_PROGRESS", "DONE"],
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

cleaningTaskSchema.index({ cleaner_id: 1, created_at: -1 });
cleaningTaskSchema.index({ shift_assignment_id: 1, created_at: -1 });

module.exports = mongoose.model("CleaningTask", cleaningTaskSchema);
