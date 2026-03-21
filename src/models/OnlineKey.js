const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const Booking = require("./Bookings");

const MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_COOLDOWN_MINUTES = 5;

const onlineKeySchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        booking_id: {
            type: String,
            required: [true, "Booking ID is required"],
            ref: "Booking",
        },
        pod_id: {
            type: String,
            required: [true, "Pod ID is required"],
            ref: "Pod",
        },
        user_id: {
            type: String,
            required: [true, "User ID is required"],
            ref: "User",
        },
        key_type: {
            type: String,
            enum: {
                values: ["CUSTOMER", "CLEANER", "MANAGER"],
                message: "{VALUE} is not a valid key type",
            },
            required: true,
            trim: true,
        },
        key_token: {
            type: String,
            required: [true, "Key token is required"],
            trim: true,
        },
        valid_from: {
            type: Date,
            required: [true, "Valid from date is required"],
        },
        valid_to: {
            type: Date,
            required: [true, "Valid to date is required"],
        },
        is_revoked: {
            type: Boolean,
            default: false,
            required: true,
        },
        failed_attempts: {
            type: Number,
            default: 0,
            min: 0,
            required: true,
        },
        locked_until: {
            type: Date,
            default: null,
        },
        last_failed_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for faster queries
onlineKeySchema.index({ booking_id: 1 });
onlineKeySchema.index({ pod_id: 1 });
onlineKeySchema.index({ user_id: 1 });
onlineKeySchema.index({ key_token: 1 });
onlineKeySchema.index({ key_type: 1 });
onlineKeySchema.index({ valid_from: 1, valid_to: 1 });
onlineKeySchema.index({ is_revoked: 1 });
onlineKeySchema.index({ key_token: 1, key_type: 1, is_revoked: 1 });
onlineKeySchema.index(
    { booking_id: 1, key_type: 1 },
    {
        unique: true,
        partialFilterExpression: { is_revoked: false },
        name: "uniq_active_online_key_per_booking_and_type",
    }
);

onlineKeySchema.methods.isLocked = function (now = new Date()) {
    return Boolean(this.locked_until && this.locked_until.getTime() > now.getTime());
};

onlineKeySchema.methods.isActiveInTimeWindow = function (now = new Date()) {
    const nowMs = now.getTime();
    return this.valid_from.getTime() <= nowMs && nowMs <= this.valid_to.getTime();
};

onlineKeySchema.methods.registerFailedAttempt = async function (cooldownMinutes = DEFAULT_COOLDOWN_MINUTES) {
    this.failed_attempts = (this.failed_attempts || 0) + 1;
    this.last_failed_at = new Date();

    if (this.failed_attempts >= MAX_FAILED_ATTEMPTS) {
        this.locked_until = new Date(Date.now() + cooldownMinutes * 60 * 1000);
    }

    await this.save();
    return this;
};

onlineKeySchema.methods.resetAttemptState = async function () {
    this.failed_attempts = 0;
    this.locked_until = null;
    this.last_failed_at = null;
    await this.save();
    return this;
};

onlineKeySchema.statics.validateOnlineKey = async function ({
    pod_id,
    key_type,
    key_token,
    cooldown_minutes = DEFAULT_COOLDOWN_MINUTES,
}) {
    const now = new Date();

    const onlineKey = await this.findOne({
        pod_id,
        key_type,
        is_revoked: false,
        valid_from: { $lte: now },
        valid_to: { $gte: now },
    }).sort({ valid_from: -1 });

    if (!onlineKey) {
        const error = new Error("Online key is expired or not active yet");
        error.statusCode = 403;
        throw error;
    }

    if (onlineKey.isLocked(now)) {
        const error = new Error("Too many failed attempts. Please wait for cooldown");
        error.statusCode = 429;
        error.cooldown_until = onlineKey.locked_until;
        throw error;
    }

    if (onlineKey.key_token !== key_token) {
        await onlineKey.registerFailedAttempt(cooldown_minutes);
        const error = new Error("Invalid online key");
        error.statusCode = 401;
        error.remaining_attempts = Math.max(0, MAX_FAILED_ATTEMPTS - onlineKey.failed_attempts);
        error.cooldown_until = onlineKey.locked_until;
        throw error;
    }

    if (String(key_type).toUpperCase() === "CLEANER") {
        const booking = await Booking.findOne({
            id: onlineKey.booking_id,
            status: { $in: ["BOOKED", "IN_USE", "COMPLETED"] },
        }).select("id cleaner_access_allowed");

        if (!booking || !booking.cleaner_access_allowed) {
            const error = new Error("Cleaner access is not confirmed by user");
            error.statusCode = 403;
            throw error;
        }
    }

    if (onlineKey.failed_attempts > 0 || onlineKey.locked_until || onlineKey.last_failed_at) {
        await onlineKey.resetAttemptState();
    }

    return onlineKey;
};

onlineKeySchema.statics.MAX_FAILED_ATTEMPTS = MAX_FAILED_ATTEMPTS;
onlineKeySchema.statics.DEFAULT_COOLDOWN_MINUTES = DEFAULT_COOLDOWN_MINUTES;

const OnlineKey = mongoose.model("OnlineKey", onlineKeySchema);

module.exports = OnlineKey;
