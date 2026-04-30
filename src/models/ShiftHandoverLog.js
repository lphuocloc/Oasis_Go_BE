const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const shiftHandoverLogSchema = new mongoose.Schema(
	{
		id: {
			type: String,
			default: () => uuidv4(),
			unique: true,
			required: true,
		},
		location_id: {
			type: String,
			required: [true, "Location ID is required"],
			ref: "Location",
			index: true,
		},
		shift_id: {
			type: String,
			required: [true, "Shift ID is required"],
			ref: "StaffShift",
			index: true,
		},
		manager_id: {
			type: String,
			required: [true, "Manager ID is required"],
			ref: "User",
			index: true,
		},
		note_text: {
			type: String,
			required: [true, "Handover note is required"],
			trim: true,
		},
	},
	{
		timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
	}
);

shiftHandoverLogSchema.index({ location_id: 1, created_at: -1 });

shiftHandoverLogSchema.virtual("manager", {
	ref: "User",
	localField: "manager_id",
	foreignField: "id",
	justOne: true,
});

shiftHandoverLogSchema.virtual("shift", {
	ref: "StaffShift",
	localField: "shift_id",
	foreignField: "id",
	justOne: true,
});

shiftHandoverLogSchema.virtual("location", {
	ref: "Location",
	localField: "location_id",
	foreignField: "id",
	justOne: true,
});

shiftHandoverLogSchema.set("toJSON", { virtuals: true });
shiftHandoverLogSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("ShiftHandoverLog", shiftHandoverLogSchema);
