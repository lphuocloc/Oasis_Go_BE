const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const staffWorkRosterSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    staff_id: {
      type: String,
      required: [true, "Staff ID is required"],
      ref: "User",
      index: true,
    },
    location_shift_id: {
      type: String,
      required: [true, "Location shift ID is required"],
      ref: "LocationShift",
      index: true,
    },
    day_of_week: {
      type: Number,
      required: [true, "day_of_week is required"],
      min: [0, "day_of_week must be from 0 to 6"],
      max: [6, "day_of_week must be from 0 to 6"],
      index: true,
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

staffWorkRosterSchema.index(
  { staff_id: 1, location_shift_id: 1, day_of_week: 1 },
  { unique: true }
);

staffWorkRosterSchema.virtual("staff", {
  ref: "User",
  localField: "staff_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.virtual("locationShift", {
  ref: "LocationShift",
  localField: "location_shift_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.set("toJSON", { virtuals: true });
staffWorkRosterSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("StaffWorkRoster", staffWorkRosterSchema);
