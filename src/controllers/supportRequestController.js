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
    res.status(error.statusCode || 500).json({
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
    res.status(error.statusCode || 500).json({
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
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update support request status",
    });
  }
};

const getRoomChangeCandidates = async (req, res) => {
  try {
    const result = await supportRequestService.getRoomChangeCandidates(
      req.params.id,
      req.user,
      req.managerScope
    );

    res.status(200).json({
      success: true,
      message: "Room-change candidates retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve room-change candidates",
    });
  }
};

const executeRoomChange = async (req, res) => {
  try {
    const result = await supportRequestService.executeRoomChange(
      req.params.id,
      req.user,
      req.managerScope,
      req.body
    );

    res.status(200).json({
      success: true,
      message: "Emergency room change completed successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to execute emergency room change",
    });
  }
};

const getSupportRequestById = async (req, res) => {
  try {
    const supportRequest = await supportRequestService.getSupportRequestById(
      req.params.id,
      req.user,
      req.managerScope
    );

    res.status(200).json({
      success: true,
      message: "Support request details retrieved successfully",
      data: supportRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve support request details",
    });
  }
};

const cancelSupportRequest = async (req, res) => {
  try {
    const supportRequest = await supportRequestService.cancelSupportRequest(
      req.params.id,
      req.user
    );

    res.status(200).json({
      success: true,
      message: "Support request canceled successfully",
      data: supportRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to cancel support request",
    });
  }
};

module.exports = {
  createSupportRequest,
  getSupportRequests,
  getSupportRequestById,
  updateSupportRequestStatus,
  getRoomChangeCandidates,
  executeRoomChange,
  cancelSupportRequest,
};
