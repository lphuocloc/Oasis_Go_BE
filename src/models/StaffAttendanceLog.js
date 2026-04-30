const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const staffAttendanceLogSchema = new mongoose.Schema(
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
			default: null,
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
		work_date: {
			type: Date,
			required: false,
			index: true,
		},
		action: {
			type: String,
			required: true,
			enum: {
				values: ["CHECKIN", "CHECKOUT"],
				message: "{VALUE} is not a valid action",
			},
			index: true,
		},
	},
	{
		timestamps: { createdAt: "created_at", updatedAt: false },
	}
);

staffAttendanceLogSchema.index({ staff_id: 1, shift_id: 1, created_at: 1 });
staffAttendanceLogSchema.index(
	{ staff_id: 1, shift_id: 1, work_date: 1, action: 1 },
	{ unique: true, sparse: true }
);

staffAttendanceLogSchema.virtual("staff", {
	ref: "User",
	localField: "staff_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.virtual("shift", {
	ref: "StaffShift",
	localField: "shift_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.virtual("location", {
	ref: "Location",
	localField: "location_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.virtual("cluster", {
	ref: "PodCluster",
	localField: "cluster_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.set("toJSON", { virtuals: true });
staffAttendanceLogSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("StaffAttendanceLog", staffAttendanceLogSchema);
