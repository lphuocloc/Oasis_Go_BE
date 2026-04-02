const cleaningBufferPolicyService = require("../services/cleaningBufferPolicyService");

exports.getAllPolicies = async (req, res) => {
  try {
    const policies = await cleaningBufferPolicyService.getAllPolicies(req.query);
    res.status(200).json({
      success: true,
      count: policies.length,
      data: policies,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get cleaning buffer policies",
    });
  }
};

exports.getPolicyById = async (req, res) => {
  try {
    const policy = await cleaningBufferPolicyService.getPolicyById(req.params.id);
    res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get cleaning buffer policy",
    });
  }
};

exports.createPolicy = async (req, res) => {
  try {
    const policy = await cleaningBufferPolicyService.createPolicy(req.body);
    res.status(201).json({
      success: true,
      message: "Cleaning buffer policy created successfully",
      data: policy,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create cleaning buffer policy",
    });
  }
};

exports.updatePolicy = async (req, res) => {
  try {
    const policy = await cleaningBufferPolicyService.updatePolicy(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Cleaning buffer policy updated successfully",
      data: policy,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update cleaning buffer policy",
    });
  }
};

exports.deletePolicy = async (req, res) => {
  try {
    await cleaningBufferPolicyService.deletePolicy(req.params.id);
    res.status(200).json({
      success: true,
      message: "Cleaning buffer policy deleted successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to delete cleaning buffer policy",
    });
  }
};
