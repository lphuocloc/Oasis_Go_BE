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
		shift_assignment_id: {
			type: String,
			required: [true, "Shift assignment ID is required"],
			ref: "StaffShiftAssignment",
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

staffAttendanceLogSchema.index({ shift_assignment_id: 1, created_at: 1 });
staffAttendanceLogSchema.index(
	{ shift_assignment_id: 1, work_date: 1, action: 1 },
	{ unique: true, sparse: true }
);

staffAttendanceLogSchema.virtual("staff", {
	ref: "User",
	localField: "staff_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.virtual("shiftAssignment", {
	ref: "StaffShiftAssignment",
	localField: "shift_assignment_id",
	foreignField: "id",
	justOne: true,
});

staffAttendanceLogSchema.set("toJSON", { virtuals: true });
staffAttendanceLogSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("StaffAttendanceLog", staffAttendanceLogSchema);
