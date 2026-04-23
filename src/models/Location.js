const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const NodeGeocoder = require('node-geocoder');
const geocoder = NodeGeocoder({ provider: 'openstreetmap' });

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
            city: {
                type: String,
                default: null,
                trim: true,
            },
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
// Note: id already has unique index from schema definition
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
    const visited = new Set([this.id]);

    while (current.parent_id) {
        if (visited.has(String(current.parent_id))) {
            break; // Circular reference detected
        }
        visited.add(String(current.parent_id));

        current = await this.model("Location").findOne({ id: current.parent_id });
        if (current) {
            path.unshift(current);
        } else {
            break;
        }
    }

    return path;
};

locationSchema.statics.getTree = async function (rootId = null, visited = new Set()) {
    if (rootId && visited.has(String(rootId))) return [];
    if (rootId) visited.add(String(rootId));

    const locations = await this.find({ parent_id: rootId });
    const tree = [];

    for (const location of locations) {
        // Prevent infinite recurse if child id points to itself
        if (visited.has(String(location.id))) continue;

        const children = await this.getTree(location.id, new Set(visited));
        tree.push({
            ...location.toObject(),
            children: children.length > 0 ? children : undefined,
        });
    }

    return tree;
};

locationSchema.statics.getDescendants = async function (locationId, visited = new Set()) {
    const descendants = [];
    if (visited.has(String(locationId))) return descendants;
    visited.add(String(locationId));

    const children = await this.find({ parent_id: locationId });

    for (const child of children) {
        if (visited.has(String(child.id))) continue;
        descendants.push(child);
        const childDescendants = await this.getDescendants(child.id, new Set(visited));
        descendants.push(...childDescendants);
    }

    return descendants;
};

// Pre-save validation: ensure parent exists if parent_id is provided

// Pre-save validation: ensure parent exists if parent_id is provided
locationSchema.pre("save", async function () {
    if (this.parent_id && this.parent_id !== null) {
        const parent = await this.model("Location").findOne({ id: this.parent_id });
        if (!parent) {
            throw new Error("Parent location does not exist");
        }
    }

    // Auto-detect city from lat/lng if present and changed
    if (this.isModified("lat") || this.isModified("lng")) {
        if (typeof this.lat === "number" && typeof this.lng === "number" && this.lat !== null && this.lng !== null) {
            try {
                const res = await geocoder.reverse({ lat: this.lat, lon: this.lng });
                this.city = res[0]?.city || res[0]?.town || res[0]?.village || null;
                console.log(`Auto-detected city for location ${this.name}: ${this.city}`);
            } catch (err) {
                this.city = null;
                console.error(`Error occurred while auto-detecting city for location ${this.name}:`, err);
            }
        } else {
            this.city = null;
        }
    }
});

const Location = mongoose.model("Location", locationSchema);

module.exports = Location;
