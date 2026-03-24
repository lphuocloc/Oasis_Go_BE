const staffShiftAssignmentService = require("../services/staffShiftAssignmentService");

const getMyAssignments = async (req, res) => {
  try {
    const result = await staffShiftAssignmentService.getMyAssignments({
      user: req.user,
      work_date: req.query.work_date,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      status: req.query.status,
    });

    res.status(200).json({
      success: true,
      message: "My shift assignments retrieved successfully",
      ...result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve my shift assignments",
    });
  }
};

const createAssignment = async (req, res) => {
  try {
    const assignment = await staffShiftAssignmentService.createAssignment(req.body);
    res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      data: assignment,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create assignment",
    });
  }
};

const getAssignments = async (req, res) => {
  try {
    const assignments = await staffShiftAssignmentService.getAssignments(req.query);
    res.status(200).json({
      success: true,
      count: assignments.length,
      data: assignments,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve assignments",
    });
  }
};

const getAssignmentById = async (req, res) => {
  try {
    const assignment = await staffShiftAssignmentService.getAssignmentById(req.params.id);
    res.status(200).json({
      success: true,
      data: assignment,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve assignment",
    });
  }
};

const updateAssignment = async (req, res) => {
  try {
    const assignment = await staffShiftAssignmentService.updateAssignment(
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      message: "Assignment updated successfully",
      data: assignment,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update assignment",
    });
  }
};

const deleteAssignment = async (req, res) => {
  try {
    await staffShiftAssignmentService.deleteAssignment(req.params.id);
    res.status(200).json({
      success: true,
      message: "Assignment deleted successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to delete assignment",
    });
  }
};



const checkinWork = async (req, res) => {
  try {
    const result = await staffShiftAssignmentService.checkinWork({
      shift_assignment_id: req.body.shift_assignment_id,
      user: req.user,
    });

    res.status(200).json({
      success: true,
      message: "Check-in successful",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to check in",
    });
  }
};

const checkoutWork = async (req, res) => {
  try {
    const result = await staffShiftAssignmentService.checkoutWork({
      shift_assignment_id: req.body.shift_assignment_id,
      user: req.user,
    });

    res.status(200).json({
      success: true,
      message: "Check-out successful",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to check out",
    });
  }
};

module.exports = {
  getMyAssignments,
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  checkinWork,
  checkoutWork,
};
