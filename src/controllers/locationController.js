const locationService = require("../services/locationService");

// @desc    Get all locations
// @route   GET /api/locations
// @access  Public
exports.getAllLocations = async (req, res) => {
    try {
        const { type, parent_id, isActive } = req.query;

        const locations = await locationService.getAllLocations({ type, parent_id, isActive });

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
        const location = await locationService.getLocationById(req.params.id);

        res.status(200).json({
            success: true,
            data: location,
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error fetching location",
        });
    }
};

// @desc    Get location tree/hierarchy
// @route   GET /api/locations/tree
// @access  Public
exports.getLocationTree = async (req, res) => {
    try {
        const { rootId } = req.query;

        const tree = await locationService.getLocationTree(rootId || null);

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
        const path = await locationService.getLocationPath(req.params.id);

        res.status(200).json({
            success: true,
            data: path,
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error fetching location path",
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
        const { name, type, parent_id, description, address, isActive } = req.body;

        const location = await locationService.createLocation({
            type,
            name,
            description,
            parent_id,
            address,
            isActive,
        });

        res.status(201).json({
            success: true,
            message: "Location created successfully",
            data: location,
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error creating location",
        });
    }
};

// @desc    Update location
// @route   PUT /api/locations/:id
// @access  Private (Admin)
exports.updateLocation = async (req, res) => {
    try {
        const { name, type, parent_id, description, address, isActive } = req.body;

        const location = await locationService.updateLocation(req.params.id, {
            type,
            name,
            description,
            parent_id,
            address,
            isActive,
        });

        res.status(200).json({
            success: true,
            message: "Location updated successfully",
            data: location,
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error updating location",
        });
    }
};

// @desc    Delete location
// @route   DELETE /api/locations/:id
// @access  Private (Admin)
exports.deleteLocation = async (req, res) => {
    try {
        const result = await locationService.deleteLocation(req.params.id);

        res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error deleting location",
        });
    }
};


