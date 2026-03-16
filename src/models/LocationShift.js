const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const locationShiftSchema = new mongoose.Schema(
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
	},
	{
		timestamps: { createdAt: "created_at", updatedAt: false },
	}
);

locationShiftSchema.index({ location_id: 1, shift_id: 1 }, { unique: true });

locationShiftSchema.virtual("location", {
	ref: "Location",
	localField: "location_id",
	foreignField: "id",
	justOne: true,
});

locationShiftSchema.virtual("shift", {
	ref: "StaffShift",
	localField: "shift_id",
	foreignField: "id",
	justOne: true,
});

locationShiftSchema.set("toJSON", { virtuals: true });
locationShiftSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("LocationShift", locationShiftSchema);
