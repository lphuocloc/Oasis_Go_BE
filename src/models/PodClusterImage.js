const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podClusterImageSchema = new mongoose.Schema(
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
        image_url: {
            type: String,
            required: [true, "Image URL is required"],
            trim: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Index for faster queries
podClusterImageSchema.index({ cluster_id: 1 });

// Virtual for pod cluster details
podClusterImageSchema.virtual("podCluster", {
    ref: "PodCluster",
    localField: "cluster_id",
    foreignField: "id",
    justOne: true,
});

const PodClusterImage = mongoose.model("PodClusterImage", podClusterImageSchema);

module.exports = PodClusterImage;
