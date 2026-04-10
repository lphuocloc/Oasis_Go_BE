const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const WEEK_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const normalizeUtcTime = (value) => {
    const raw = String(value || "").trim();
    if (!TIME_REGEX.test(raw)) return raw;

    const parts = raw.split(":");
    if (parts.length === 2) {
        return `${parts[0]}:${parts[1]}:00`;
    }
    return raw;
};

const timeToSeconds = (timeValue) => {
    const normalized = normalizeUtcTime(timeValue);
    const [hours, minutes, seconds] = normalized.split(":").map((part) => Number(part));
    return hours * 3600 + minutes * 60 + seconds;
};

const pricingRuleSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        location_id: {
            type: String,
            default: null,
            ref: "Location",
            index: true,
        },
        pod_id: {
            type: String,
            default: null,
            ref: "Pod",
            index: true,
        },
        start_time: {
            type: String,
            required: [true, "Start time is required"],
            validate: {
                validator: (value) => TIME_REGEX.test(String(value || "")),
                message: "start_time must follow HH:mm or HH:mm:ss format",
            },
        },
        end_time: {
            type: String,
            required: [true, "End time is required"],
            validate: {
                validator: (value) => TIME_REGEX.test(String(value || "")),
                message: "end_time must follow HH:mm or HH:mm:ss format",
            },
        },
        days_of_week: {
            type: [String],
            required: [true, "days_of_week is required"],
            validate: {
                validator: (days) =>
                    Array.isArray(days) &&
                    days.length > 0 &&
                    days.every((day) => WEEK_DAYS.includes(String(day || "").toUpperCase())),
                message: `days_of_week must be a non-empty array of: ${WEEK_DAYS.join(", ")}`,
            },
            set: (days) =>
                Array.isArray(days)
                    ? days.map((day) => String(day || "").trim().toUpperCase()).filter(Boolean)
                    : days,
        },
        multiplier: {
            type: Number,
            required: [true, "Multiplier is required"],
            min: [0, "multiplier must be greater than or equal to 0"],
            validate: {
                validator: Number.isFinite,
                message: "multiplier must be a finite number",
            },
        },
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

pricingRuleSchema.index({ pod_id: 1, is_active: 1, createdAt: -1 });
pricingRuleSchema.index({ location_id: 1, is_active: 1, createdAt: -1 });

pricingRuleSchema.pre("validate", function () {
    this.start_time = normalizeUtcTime(this.start_time);
    this.end_time = normalizeUtcTime(this.end_time);

    const scopeIds = [this.location_id, this.pod_id];
    const nonNullCount = scopeIds.filter((value) => value !== null && value !== undefined && value !== "").length;

    if (nonNullCount !== 1) {
        throw new Error("Exactly one of location_id or pod_id must be provided");
    }
});

pricingRuleSchema.methods.matchesUtcDate = function (date = new Date()) {
    const utcDay = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getUTCDay()];
    const ruleDays = Array.isArray(this.days_of_week) ? this.days_of_week : [];

    if (!ruleDays.includes(utcDay)) {
        return false;
    }

    const currentSeconds =

        date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
    const startSeconds = timeToSeconds(this.start_time);
    const endSeconds = timeToSeconds(this.end_time);

    if (startSeconds <= endSeconds) {
        return currentSeconds >= startSeconds && currentSeconds < endSeconds;
    }

    // Overnight window in UTC (e.g. 22:00:00 -> 02:00:00).
    return currentSeconds >= startSeconds || currentSeconds < endSeconds;
};

pricingRuleSchema.pre("save", async function () {
    const Location = mongoose.model("Location");
    const Pod = mongoose.model("Pod");

    if (this.location_id) {
        const location = await Location.findOne({ id: this.location_id }).select("id").lean();
        if (!location) {
            throw new Error("Location does not exist");
        }
    }

    if (this.pod_id) {
        const pod = await Pod.findOne({ id: this.pod_id }).select("id cluster_id").lean();
        if (!pod) {
            throw new Error("Pod does not exist");
        }
    }
});

// Backward compatibility for old clients using price_modifier.
pricingRuleSchema.virtual("price_modifier")
    .get(function () {
        return this.multiplier;
    })
    .set(function (value) {
        this.multiplier = value;
    });

module.exports = mongoose.model("PricingRule", pricingRuleSchema);
