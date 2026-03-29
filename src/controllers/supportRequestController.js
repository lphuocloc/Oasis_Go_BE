const supportRequestService = require("../services/supportRequestService");

const createSupportRequest = async (req, res) => {
  try {
    const supportRequest = await supportRequestService.createSupportRequest(
      req.user,
      req.body
    );

    res.status(201).json({
      success: true,
      message: "Support request created successfully",
      data: supportRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create support request",
    });
  }
};

const getSupportRequests = async (req, res) => {
  try {
    const result = await supportRequestService.getSupportRequests(
      req.user,
      req.managerScope,
      req.query
    );

    res.status(200).json({
      success: true,
      message: "Support requests retrieved successfully",
      data: result.requests,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to retrieve support requests",
    });
  }
};

const updateSupportRequestStatus = async (req, res) => {
  try {
    const supportRequest = await supportRequestService.updateSupportRequestStatus(
      req.params.id,
      req.user,
      req.managerScope,
      req.body
    );

    res.status(200).json({
      success: true,
      message: "Support request status updated successfully",
      data: supportRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update support request status",
    });
  }
};

module.exports = {
  createSupportRequest,
  getSupportRequests,
  updateSupportRequestStatus,
};
