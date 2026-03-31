const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const staffShiftAssignmentSchema = new mongoose.Schema(
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
		start_date: {
			type: Date,
			required: [true, "Start date is required"],
			index: true,
		},
		end_date: {
			type: Date,
			required: [true, "End date is required"],
			index: true,
		},
		status: {
			type: String,
			required: true,
			default: "ASSIGNED",
			enum: {
				values: ["ASSIGNED", "COMPLETED", "ABSENT"],
				message: "{VALUE} is not a valid status",
			},
			index: true,
		},
		start_time: {
			type: String,
			default: null,
			match: [/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "Start time must be HH:mm or HH:mm:ss"],
		},
		end_time: {
			type: String,
			default: null,
			match: [/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "End time must be HH:mm or HH:mm:ss"],
		},
	},
	{
		timestamps: { createdAt: "created_at", updatedAt: false },
	}
);

staffShiftAssignmentSchema.index(
	{ staff_id: 1, location_shift_id: 1, start_date: 1, end_date: 1 },
	{ unique: true }
);

staffShiftAssignmentSchema.virtual("staff", {
	ref: "User",
	localField: "staff_id",
	foreignField: "id",
	justOne: true,
});

staffShiftAssignmentSchema.virtual("locationShift", {
	ref: "LocationShift",
	localField: "location_shift_id",
	foreignField: "id",
	justOne: true,
});

staffShiftAssignmentSchema.set("toJSON", { virtuals: true });
staffShiftAssignmentSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("StaffShiftAssignment", staffShiftAssignmentSchema);
