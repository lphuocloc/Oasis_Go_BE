const podClusterService = require("../services/podClusterService");

// @desc    Get all pod clusters
// @route   GET /api/pod-clusters
// @access  Public
exports.getAllPodClusters = async (req, res) => {
  try {
    const { location_id } = req.query;
    
    const podClusters = await podClusterService.getAllPodClusters({ location_id });
    
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
    const podCluster = await podClusterService.getPodClusterById(req.params.id);
    
    res.status(200).json({
      success: true,
      data: podCluster,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching pod cluster",
    });
  }
};

// @desc    Get pod clusters by location
// @route   GET /api/pod-clusters/location/:locationId
// @access  Public
exports.getPodClustersByLocation = async (req, res) => {
  try {
    const podClusters = await podClusterService.getPodClustersByLocation(req.params.locationId);
    
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
    
    const podCluster = await podClusterService.createPodCluster({
      location_id,
      name,
      description,
      base_price_modifier,
    });
    
    res.status(201).json({
      success: true,
      message: "Pod cluster created successfully",
      data: podCluster,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating pod cluster",
    });
  }
};

// @desc    Update pod cluster
// @route   PUT /api/pod-clusters/:id
// @access  Private (Admin/Manager)
exports.updatePodCluster = async (req, res) => {
  try {
    const { location_id, name, description, base_price_modifier } = req.body;
    
    const podCluster = await podClusterService.updatePodCluster(req.params.id, {
      location_id,
      name,
      description,
      base_price_modifier,
    });
    
    res.status(200).json({
      success: true,
      message: "Pod cluster updated successfully",
      data: podCluster,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating pod cluster",
    });
  }
};

// @desc    Delete pod cluster
// @route   DELETE /api/pod-clusters/:id
// @access  Private (Admin/Manager)
exports.deletePodCluster = async (req, res) => {
  try {
    const result = await podClusterService.deletePodCluster(req.params.id);
    
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error deleting pod cluster",
    });
  }
};
