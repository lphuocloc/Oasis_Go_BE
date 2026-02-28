const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const podClusterSchema = new mongoose.Schema(
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
        },
        name: {
            type: String,
            required: [true, "Pod cluster name is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: null,
        },
        base_price_modifier: {
            type: Number,
            default: 0,
            validate: {
                validator: function (value) {
                    return !isNaN(value);
                },
                message: "Base price modifier must be a valid number",
            },
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Index for faster queries
// Note: id already has unique index from schema definition
podClusterSchema.index({ location_id: 1 });

// Virtual for location details
podClusterSchema.virtual("location", {
    ref: "Location",
    localField: "location_id",
    foreignField: "id",
    justOne: true,
});

// Pre-save validation: ensure location exists
podClusterSchema.pre("save", async function () {
    if (this.location_id) {
        const Location = mongoose.model("Location");
        const location = await Location.findOne({ id: this.location_id });
        if (!location) {
            throw new Error("Location does not exist");
        }
    }
});

// Static method to get pod clusters by location
podClusterSchema.statics.getByLocation = async function (locationId) {
    return await this.find({ location_id: locationId });
};

// Instance method to get full details with location
podClusterSchema.methods.getFullDetails = async function () {
    await this.populate("location");
    return this;
};

const PodCluster = mongoose.model("PodCluster", podClusterSchema);

module.exports = PodCluster;
