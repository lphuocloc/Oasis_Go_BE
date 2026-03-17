const staffShiftAssignmentService = require("../services/staffShiftAssignmentService");

const assignManager = async (req, res) => {
  try {
    const result = await staffShiftAssignmentService.assignManager({
      staff_id: req.body.staff_id,
      parent_location_id: req.body.parent_location_id,
      shift_id: req.body.shift_id,
      work_date: req.body.work_date,
    });

    res.status(201).json({
      success: true,
      message: "Manager assigned for location successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to assign manager",
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
  assignManager,
  checkinWork,
  checkoutWork,
};
