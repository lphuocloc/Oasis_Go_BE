const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const doorSchema = new mongoose.Schema(
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
            unique: true,
            ref: "Pod",
        },
        lock_status: {
            type: String,
            enum: {
                values: ["LOCKED", "UNLOCKED"],
                message: "{VALUE} is not a valid lock status",
            },
            default: "LOCKED",
            required: true,
            trim: true,
        },
        door_sensor: {
            type: String,
            enum: {
                values: ["CLOSED", "OPEN"],
                message: "{VALUE} is not a valid door sensor status",
            },
            default: "CLOSED",
            required: true,
            trim: true,
        },
        last_sync_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Index for faster queries
doorSchema.index({ pod_id: 1 });
doorSchema.index({ lock_status: 1 });
doorSchema.index({ door_sensor: 1 });

const Door = mongoose.model("Door", doorSchema);

module.exports = Door;
