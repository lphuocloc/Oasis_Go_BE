const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const locationSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        name: {
            type: String,
            required: [true, "Location name is required"],
            trim: true,
        },
        type: {
            type: String,
            required: [true, "Location type is required"],
            enum: {
                values: ["airport", "terminal", "floor", "mall", "bus_station", "waiting_lounge"],
                message: "{VALUE} is not a valid location type",
            },
        },
        lat: {
            type: Number,
            default: null,
            validate: {
                validator: function (value) {
                    if (value === null || value === undefined) return true;
                    return value >= -90 && value <= 90;
                },
                message: "Latitude must be between -90 and 90 degrees",
            },
        },
        lng: {
            type: Number,
            default: null,
            validate: {
                validator: function (value) {
                    if (value === null || value === undefined) return true;
                    return value >= -180 && value <= 180;
                },
                message: "Longitude must be between -180 and 180 degrees",
            },
        },
        parent_id: {
            type: String,
            default: null,
            ref: "Location",
        },
        description: {
            type: String,
            trim: true,
            default: null,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Index for faster queries
locationSchema.index({ id: 1 });
locationSchema.index({ parent_id: 1 });
locationSchema.index({ type: 1 });
locationSchema.index({ lat: 1, lng: 1 });

// Virtual for children locations
locationSchema.virtual("children", {
    ref: "Location",
    localField: "id",
    foreignField: "parent_id",
});

// Method to get full hierarchy path
locationSchema.methods.getHierarchyPath = async function () {
    const path = [this];
    let current = this;

    while (current.parent_id) {
        current = await this.model("Location").findOne({ id: current.parent_id });
        if (current) {
            path.unshift(current);
        } else {
            break;
        }
    }

    return path;
};

// Static method to get location tree
locationSchema.statics.getTree = async function (rootId = null) {
    const locations = await this.find({ parent_id: rootId });
    const tree = [];

    for (const location of locations) {
        const children = await this.getTree(location.id);
        tree.push({
            ...location.toObject(),
            children: children.length > 0 ? children : undefined,
        });
    }

    return tree;
};

// Static method to get all descendants
locationSchema.statics.getDescendants = async function (locationId) {
    const descendants = [];
    const children = await this.find({ parent_id: locationId });

    for (const child of children) {
        descendants.push(child);
        const childDescendants = await this.getDescendants(child.id);
        descendants.push(...childDescendants);
    }

    return descendants;
};

// Pre-save validation: ensure parent exists if parent_id is provided
locationSchema.pre("save", async function () {
    if (this.parent_id && this.parent_id !== null) {
        const parent = await this.model("Location").findOne({ id: this.parent_id });
        if (!parent) {
            throw new Error("Parent location does not exist");
        }
    }
});

const Location = mongoose.model("Location", locationSchema);

module.exports = Location;
