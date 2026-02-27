const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        cluster_id: {
            type: String,
            required: [true, "Cluster ID is required"],
            ref: "PodCluster",
        },
        code: {
            type: String,
            required: [true, "Pod code is required"],
            // unique: true removed - code is only unique within a cluster, not globally
            trim: true,
            uppercase: true,
        },
        name: {
            type: String,
            required: [true, "Pod name is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: null,
        },
        status: {
            type: String,
            enum: {
                values: ["AVAILABLE", "OCCUPIED", "NEEDS_CLEANING", "CLEANING", "MAINTENANCE"],
                message: "{VALUE} is not a valid status",
            },
            default: "AVAILABLE",
            required: true,
        },
        maintenance_status: {
            type: String,
            trim: true,
            default: null,
        },
        soundproof_level: {
            type: Number,
            min: [1, "Soundproof level must be at least 1"],
            max: [5, "Soundproof level must be at most 5"],
            default: 3,
        },
        ventilation_level: {
            type: Number,
            min: [1, "Ventilation level must be at least 1"],
            max: [5, "Ventilation level must be at most 5"],
            default: 3,
        },
        power_outlets: {
            type: Number,
            min: [0, "Power outlets cannot be negative"],
            default: 2,
        },
        wifi_available: {
            type: Boolean,
            default: true,
        },
        max_session_duration: {
            type: Number,
            min: [60, "Max session duration must be at least 60 minutes"],
            default: 480, // 8 hours in minutes
        },
        last_cleaned_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Indexes for faster queries
// Compound unique index: code must be unique within each cluster
podSchema.index({ cluster_id: 1, code: 1 }, { unique: true });
podSchema.index({ status: 1 });
podSchema.index({ cluster_id: 1, status: 1 }); // Compound index for common queries

// Virtual for cluster details
podSchema.virtual("cluster", {
    ref: "PodCluster",
    localField: "cluster_id",
    foreignField: "id",
    justOne: true,
});

// Pre-save validation: ensure cluster exists
podSchema.pre("save", async function () {
    if (this.cluster_id) {
        const PodCluster = mongoose.model("PodCluster");
        const cluster = await PodCluster.findOne({ id: this.cluster_id });
        if (!cluster) {
            throw new Error("Pod cluster does not exist");
        }
    }

    // Auto-update last_cleaned_at when status changes to AVAILABLE from CLEANING
    if (this.isModified("status") && this.status === "AVAILABLE" && this._previousStatus === "CLEANING") {
        this.last_cleaned_at = new Date();
    }
});

// Middleware to track previous status
podSchema.pre("save", function (next) {
    if (this.isModified("status")) {
        this._previousStatus = this.status;
    }
    next();
});

// Static method to get pods by cluster
podSchema.statics.getByCluster = async function (clusterId) {
    return await this.find({ cluster_id: clusterId }).populate("cluster");
};

// Static method to get available pods
podSchema.statics.getAvailable = async function (clusterId = null) {
    const filter = { status: "AVAILABLE" };
    if (clusterId) filter.cluster_id = clusterId;
    return await this.find(filter).populate("cluster");
};

// Static method to get pods that need cleaning
podSchema.statics.getNeedsCleaning = async function (clusterId = null) {
    const filter = { status: "NEEDS_CLEANING" };
    if (clusterId) filter.cluster_id = clusterId;
    return await this.find(filter).populate("cluster");
};

// Static method to get pods by status
podSchema.statics.getByStatus = async function (status, clusterId = null) {
    const filter = { status };
    if (clusterId) filter.cluster_id = clusterId;
    return await this.find(filter).populate("cluster");
};

// Instance method to mark pod as occupied
podSchema.methods.markAsOccupied = async function () {
    if (this.status !== "AVAILABLE") {
        throw new Error(`Cannot occupy pod with status ${this.status}`);
    }
    this.status = "OCCUPIED";
    await this.save();
    return this;
};

// Instance method to mark pod as available
podSchema.methods.markAsAvailable = async function () {
    if (this.status === "NEEDS_CLEANING" || this.status === "CLEANING") {
        throw new Error("Pod must be cleaned before becoming available");
    }
    this.status = "AVAILABLE";
    await this.save();
    return this;
};

// Instance method to mark pod as needing cleaning
podSchema.methods.markAsNeedsCleaning = async function () {
    this.status = "NEEDS_CLEANING";
    await this.save();
    return this;
};

// Instance method to mark pod as being cleaned
podSchema.methods.startCleaning = async function () {
    if (this.status !== "NEEDS_CLEANING") {
        throw new Error("Pod must be in NEEDS_CLEANING status to start cleaning");
    }
    this.status = "CLEANING";
    await this.save();
    return this;
};

// Instance method to complete cleaning
podSchema.methods.completeCleaning = async function () {
    if (this.status !== "CLEANING") {
        throw new Error("Pod must be in CLEANING status to complete cleaning");
    }
    this.status = "AVAILABLE";
    this.last_cleaned_at = new Date();
    await this.save();
    return this;
};

// Instance method to mark pod for maintenance
podSchema.methods.markForMaintenance = async function (reason = null) {
    this.status = "MAINTENANCE";
    if (reason) this.maintenance_status = reason;
    await this.save();
    return this;
};

// Instance method to get full details with cluster info
podSchema.methods.getFullDetails = async function () {
    await this.populate("cluster");
    return this;
};

const Pod = mongoose.model("Pod", podSchema);

module.exports = Pod;
