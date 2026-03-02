const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const timeSlotSchema = new mongoose.Schema(
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
        start_time: {
            type: Date,
            required: [true, "Start time is required"],
            index: true,
        },
        end_time: {
            type: Date,
            required: [true, "End time is required"],
            index: true,
            validate: {
                validator: function (value) {
                    return value > this.start_time;
                },
                message: "End time must be after start time"
            }
        },
        status: {
            type: String,
            enum: {
                values: ["AVAILABLE", "RESERVED"],
                message: "{VALUE} is not a valid status",
            },
            default: "AVAILABLE",
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Index for efficient queries
timeSlotSchema.index({ pod_id: 1, start_time: 1, end_time: 1 });
timeSlotSchema.index({ pod_id: 1, status: 1 });

const TimeSlot = mongoose.model("TimeSlot", timeSlotSchema);

module.exports = TimeSlot;
