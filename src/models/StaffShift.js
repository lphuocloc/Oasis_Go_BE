const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const staffShiftSchema = new mongoose.Schema(
	{
		id: {
			type: String,
			default: () => uuidv4(),
			unique: true,
			required: true,
		},
		role: {
			type: String,
			required: [true, "Role is required"],
			enum: {
				values: ["CLEANER", "MANAGER"],
				message: "{VALUE} is not a valid role",
			},
			index: true,
		},
		shift_name: {
			type: String,
			required: [true, "Shift name is required"],
			enum: {
				values: ["MORNING", "AFTERNOON", "NIGHT"],
				message: "{VALUE} is not a valid shift name",
			},
		},
		start_time: {
			type: String,
			required: [true, "Start time is required"],
			match: [/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "Start time must be HH:mm or HH:mm:ss"],
		},
		end_time: {
			type: String,
			required: [true, "End time is required"],
			match: [/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "End time must be HH:mm or HH:mm:ss"],
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

staffShiftSchema.index({ role: 1, shift_name: 1 }, { unique: true });

module.exports = mongoose.model("StaffShift", staffShiftSchema);
