const podService = require("../services/podService");

// @desc    Create pods (Grid or Single mode)
// @route   POST /api/pods/create
// @access  Private (Admin/Manager)
exports.createPods = async (req, res) => {
  try {
    const createdPods = await podService.createPods(req.body);
    
    res.status(201).json({
      success: true,
      message: `Successfully created ${createdPods.length} pod(s)`,
      count: createdPods.length,
      data: createdPods,
    });
  } catch (error) {
    console.error("Create pods error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating pods",
    });
  }
};

// @desc    Get all pods
// @route   GET /api/pods
// @access  Public
exports.getAllPods = async (req, res) => {
  try {
    const { cluster_id, status, code } = req.query;
    
    const pods = await podService.getAllPods({ cluster_id, status, code });
    
    res.status(200).json({
      success: true,
      count: pods.length,
      data: pods,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching pods",
      error: error.message,
    });
  }
};

// @desc    Get pod by ID
// @route   GET /api/pods/:id
// @access  Public
exports.getPodById = async (req, res) => {
  try {
    const pod = await podService.getPodById(req.params.id);
    
    res.status(200).json({
      success: true,
      data: pod,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching pod",
    });
  }
};

// @desc    Get pods by cluster
// @route   GET /api/pods/cluster/:clusterId
// @access  Public
exports.getPodsByCluster = async (req, res) => {
  try {
    const pods = await podService.getPodsByCluster(req.params.clusterId);
    
    res.status(200).json({
      success: true,
      count: pods.length,
      data: pods,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching pods by cluster",
      error: error.message,
    });
  }
};

// @desc    Get available pods
// @route   GET /api/pods/cluster/:clusterId/available
// @access  Public
exports.getAvailablePods = async (req, res) => {
  try {
    const pods = await podService.getAvailablePodsByCluster(req.params.clusterId);
    
    res.status(200).json({
      success: true,
      count: pods.length,
      data: pods,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching available pods",
      error: error.message,
    });
  }
};

// @desc    Update pod
// @route   PUT /api/pods/:id
// @access  Private (Admin/Manager)
exports.updatePod = async (req, res) => {
  try {
    const pod = await podService.updatePod(req.params.id, req.body);
    
    res.status(200).json({
      success: true,
      message: "Pod updated successfully",
      data: pod,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating pod",
    });
  }
};

// @desc    Delete pod
// @route   DELETE /api/pods/:id
// @access  Private (Admin/Manager)
exports.deletePod = async (req, res) => {
  try {
    const result = await podService.deletePod(req.params.id);
    
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error deleting pod",
    });
  }
};

// @desc    Update pod status
// @route   PATCH /api/pods/:id/status
// @access  Private (Admin/Manager/Staff)
exports.updatePodStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const pod = await podService.updatePodStatus(req.params.id, { status });
    
    res.status(200).json({
      success: true,
      message: "Pod status updated successfully",
      data: pod,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating pod status",
    });
  }
};

// @desc    Complete pod cleaning (For maintenance staff)
// @route   PATCH /api/pods/:id/complete-cleaning
// @access  Private (Staff)
exports.completePodCleaning = async (req, res) => {
  try {
    const pod = await podService.updatePodStatus(req.params.id, { status: "AVAILABLE" });
    
    res.status(200).json({
      success: true,
      message: "Pod cleaning completed and status updated to AVAILABLE",
      data: pod,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error completing pod cleaning",
    });
  }
};
