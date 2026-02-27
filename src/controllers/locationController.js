const Location = require("../models/Location");
const PodCluster = require("../models/PodCluster");

// @desc    Get all locations
// @route   GET /api/locations
// @access  Public
exports.getAllLocations = async (req, res) => {
    try {
        const { type, parent_id, isActive } = req.query;
        const filter = {};

        if (type) filter.type = type;
        if (parent_id !== undefined) filter.parent_id = parent_id === "null" ? null : parent_id;
        if (isActive !== undefined) filter.isActive = isActive === "true";

        const locations = await Location.find(filter).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: locations.length,
            data: locations,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching locations",
            error: error.message,
        });
    }
};

// @desc    Get location by ID
// @route   GET /api/locations/:id
// @access  Public
exports.getLocationById = async (req, res) => {
    try {
        const location = await Location.findOne({ id: req.params.id });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        res.status(200).json({
            success: true,
            data: location,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching location",
            error: error.message,
        });
    }
};

// @desc    Get location tree/hierarchy
// @route   GET /api/locations/tree
// @access  Public
exports.getLocationTree = async (req, res) => {
    try {
        const { rootId } = req.query;
        const tree = await Location.getTree(rootId || null);

        res.status(200).json({
            success: true,
            data: tree,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching location tree",
            error: error.message,
        });
    }
};

// @desc    Get location hierarchy path
// @route   GET /api/locations/:id/path
// @access  Public
exports.getLocationPath = async (req, res) => {
    try {
        const location = await Location.findOne({ id: req.params.id });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        const path = await location.getHierarchyPath();

        res.status(200).json({
            success: true,
            data: path,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching location path",
            error: error.message,
        });
    }
};

// @desc    Get location descendants
// @route   GET /api/locations/:id/descendants
// @access  Public
exports.getLocationDescendants = async (req, res) => {
    try {
        const location = await Location.findOne({ id: req.params.id });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        const descendants = await Location.getDescendants(req.params.id);

        res.status(200).json({
            success: true,
            count: descendants.length,
            data: descendants,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching location descendants",
            error: error.message,
        });
    }
};

// @desc    Create new location
// @route   POST /api/locations
// @access  Private (Admin)
exports.createLocation = async (req, res) => {
    try {
        const { name, type, lat, lng, parent_id, description } = req.body;

        // Validate required fields
        if (!name || !type) {
            return res.status(400).json({
                success: false,
                message: "Name and type are required",
            });
        }

        // Validate parent exists if parent_id provided
        if (parent_id) {
            const parent = await Location.findOne({ id: parent_id });
            if (!parent) {
                return res.status(404).json({
                    success: false,
                    message: "Parent location not found",
                });
            }
        }

        const locationData = {
            name,
            type,
            lat: lat || null,
            lng: lng || null,
            parent_id: parent_id || null,
            description: description || null,
        };

        const location = await Location.create(locationData);

        res.status(201).json({
            success: true,
            message: "Location created successfully",
            data: location,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error creating location",
            error: error.message,
        });
    }
};

// @desc    Update location
// @route   PUT /api/locations/:id
// @access  Private (Admin)
exports.updateLocation = async (req, res) => {
    try {
        const { name, type, lat, lng, parent_id, description, isActive } = req.body;

        const location = await Location.findOne({ id: req.params.id });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        // Validate parent exists if parent_id provided
        if (parent_id !== undefined && parent_id !== null) {
            // Check if trying to set itself as parent
            if (parent_id === location.id) {
                return res.status(400).json({
                    success: false,
                    message: "Location cannot be its own parent",
                });
            }

            const parent = await Location.findOne({ id: parent_id });
            if (!parent) {
                return res.status(404).json({
                    success: false,
                    message: "Parent location not found",
                });
            }

            // Check if parent is a descendant (prevent circular reference)
            const descendants = await Location.getDescendants(location.id);
            const descendantIds = descendants.map((d) => d.id);
            if (descendantIds.includes(parent_id)) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot set a descendant as parent (circular reference)",
                });
            }
        }

        // Update fields
        if (name !== undefined) location.name = name;
        if (type !== undefined) location.type = type;
        if (lat !== undefined) location.lat = lat;
        if (lng !== undefined) location.lng = lng;
        if (parent_id !== undefined) location.parent_id = parent_id;
        if (description !== undefined) location.description = description;
        if (isActive !== undefined) location.isActive = isActive;

        await location.save();

        res.status(200).json({
            success: true,
            message: "Location updated successfully",
            data: location,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error updating location",
            error: error.message,
        });
    }
};

// @desc    Delete location
// @route   DELETE /api/locations/:id
// @access  Private (Admin)
exports.deleteLocation = async (req, res) => {
    try {
        const location = await Location.findOne({ id: req.params.id });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        // Check if location has children
        const children = await Location.find({ parent_id: req.params.id });
        if (children.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete location with children. Delete or reassign children first.",
                childrenCount: children.length,
            });
        }

        // Check if location has pod clusters
        const podClusters = await PodCluster.find({ location_id: req.params.id });
        if (podClusters.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete location with pod clusters. Delete or reassign pod clusters first.",
                podClusterCount: podClusters.length,
            });
        }

        await Location.deleteOne({ id: req.params.id });

        res.status(200).json({
            success: true,
            message: "Location deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting location",
            error: error.message,
        });
    }
};


