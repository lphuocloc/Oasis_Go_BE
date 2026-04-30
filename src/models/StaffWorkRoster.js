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
    shift_id: {
      type: String,
      required: [true, "Shift ID is required"],
      ref: "StaffShift",
      index: true,
    },
    location_id: {
      type: String,
      default: null,
      ref: "Location",
      index: true,
    },
    cluster_id: {
      type: String,
      default: null,
      ref: "PodCluster",
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
  { staff_id: 1, shift_id: 1, location_id: 1, cluster_id: 1 },
  { unique: true }
);

staffWorkRosterSchema.virtual("staff", {
  ref: "User",
  localField: "staff_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.virtual("shift", {
  ref: "StaffShift",
  localField: "shift_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.virtual("location", {
  ref: "Location",
  localField: "location_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.virtual("cluster", {
  ref: "PodCluster",
  localField: "cluster_id",
  foreignField: "id",
  justOne: true,
});

staffWorkRosterSchema.set("toJSON", { virtuals: true });
staffWorkRosterSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("StaffWorkRoster", staffWorkRosterSchema);
