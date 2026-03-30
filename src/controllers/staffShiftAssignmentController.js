const staffShiftAssignmentService = require("../services/staffShiftAssignmentService");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");

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
    if (req.user && req.user.role === "manager") {
      const staff = await User.findOne({ $or: [{ id: req.body.staff_id }, { _id: req.body.staff_id }] }).select("role").lean();
      if (!staff || staff.role !== "cleaner") {
        return res.status(403).json({ success: false, message: "Managers can only assign to cleaners" });
      }

      const locShift = await LocationShift.findOne({ id: req.body.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location shift" });
      }
    }

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
    let query = { ...req.query };

    // Auto-filter by manager scope if requested by manager, to prevent viewing other locations' assignments
    if (req.user && req.user.role === "manager") {
      const allowedLocShifts = await LocationShift.find({ location_id: { $in: req.managerScope.locationIds } }).select("id").lean();
      const allowedLocShiftIds = allowedLocShifts.map(ls => ls.id);
      
      if (query.location_shift_id) {
         if (!allowedLocShiftIds.includes(query.location_shift_id)) {
             return res.status(403).json({ success: false, message: "Out of management scope" });
         }
      } else {
         query.location_shift_ids = allowedLocShiftIds.join(',');
      }
    }

    const assignments = await staffShiftAssignmentService.getAssignments(query);
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

    if (req.user && req.user.role === "manager") {
      const locShift = await LocationShift.findOne({ id: assignment.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
      }
    }

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
    if (req.user && req.user.role === "manager") {
      const existingAssignment = await staffShiftAssignmentService.getAssignmentById(req.params.id);
      
      const checkLocShiftId = req.body.location_shift_id || existingAssignment.location_shift_id;
      const locShift = await LocationShift.findOne({ id: checkLocShiftId }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location shift" });
      }

      const checkStaffId = req.body.staff_id || existingAssignment.staff_id;
      if (checkStaffId) {
        const staff = await User.findOne({ $or: [{ id: checkStaffId }, { _id: checkStaffId }] }).select("role").lean();
        if (!staff || staff.role !== "cleaner") {
          return res.status(403).json({ success: false, message: "Managers can only assign to cleaners" });
        }
      }
    }

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
    if (req.user && req.user.role === "manager") {
      const existingAssignment = await staffShiftAssignmentService.getAssignmentById(req.params.id);
      const locShift = await LocationShift.findOne({ id: existingAssignment.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
      }
    }

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



module.exports = {
  getMyAssignments,
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
};
