const PodCluster = require("../models/PodCluster");
const Location = require("../models/Location");

// @desc    Get all pod clusters
// @route   GET /api/pod-clusters
// @access  Public
exports.getAllPodClusters = async (req, res) => {
    try {
        const { location_id } = req.query;
        const filter = {};

        if (location_id) filter.location_id = location_id;

        const podClusters = await PodCluster.find(filter)
            .populate("location")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: podClusters.length,
            data: podClusters,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pod clusters",
            error: error.message,
        });
    }
};

// @desc    Get pod cluster by ID
// @route   GET /api/pod-clusters/:id
// @access  Public
exports.getPodClusterById = async (req, res) => {
    try {
        const podCluster = await PodCluster.findOne({ id: req.params.id }).populate("location");

        if (!podCluster) {
            return res.status(404).json({
                success: false,
                message: "Pod cluster not found",
            });
        }

        res.status(200).json({
            success: true,
            data: podCluster,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pod cluster",
            error: error.message,
        });
    }
};

// @desc    Get pod clusters by location
// @route   GET /api/pod-clusters/location/:locationId
// @access  Public
exports.getPodClustersByLocation = async (req, res) => {
    try {
        const podClusters = await PodCluster.getByLocation(req.params.locationId);

        res.status(200).json({
            success: true,
            count: podClusters.length,
            data: podClusters,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pod clusters by location",
            error: error.message,
        });
    }
};

// @desc    Create new pod cluster
// @route   POST /api/pod-clusters
// @access  Private (Admin/Manager)
exports.createPodCluster = async (req, res) => {
    try {
        const { location_id, name, description, base_price_modifier } = req.body;

        // Validate required fields
        if (!location_id || !name) {
            return res.status(400).json({
                success: false,
                message: "Location ID and name are required",
            });
        }

        // Validate location exists
        const location = await Location.findOne({ id: location_id });
        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Location not found",
            });
        }

        const podClusterData = {
            location_id,
            name,
            description: description || null,
            base_price_modifier: base_price_modifier || 0,
        };

        const podCluster = await PodCluster.create(podClusterData);

        // Populate location info
        await podCluster.populate("location");

        res.status(201).json({
            success: true,
            message: "Pod cluster created successfully",
            data: podCluster,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error creating pod cluster",
            error: error.message,
        });
    }
};

// @desc    Update pod cluster
// @route   PUT /api/pod-clusters/:id
// @access  Private (Admin/Manager)
exports.updatePodCluster = async (req, res) => {
    try {
        const { location_id, name, description, base_price_modifier } = req.body;

        const podCluster = await PodCluster.findOne({ id: req.params.id });

        if (!podCluster) {
            return res.status(404).json({
                success: false,
                message: "Pod cluster not found",
            });
        }

        // Validate location exists if location_id is being updated
        if (location_id && location_id !== podCluster.location_id) {
            const location = await Location.findOne({ id: location_id });
            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: "Location not found",
                });
            }
        }

        // Update fields
        if (location_id !== undefined) podCluster.location_id = location_id;
        if (name !== undefined) podCluster.name = name;
        if (description !== undefined) podCluster.description = description;
        if (base_price_modifier !== undefined) podCluster.base_price_modifier = base_price_modifier;

        await podCluster.save();
        await podCluster.populate("location");

        res.status(200).json({
            success: true,
            message: "Pod cluster updated successfully",
            data: podCluster,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error updating pod cluster",
            error: error.message,
        });
    }
};

// @desc    Delete pod cluster
// @route   DELETE /api/pod-clusters/:id
// @access  Private (Admin/Manager)
exports.deletePodCluster = async (req, res) => {
    try {
        const podCluster = await PodCluster.findOne({ id: req.params.id });

        if (!podCluster) {
            return res.status(404).json({
                success: false,
                message: "Pod cluster not found",
            });
        }

        await PodCluster.deleteOne({ id: req.params.id });

        res.status(200).json({
            success: true,
            message: "Pod cluster deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting pod cluster",
            error: error.message,
        });
    }
};


