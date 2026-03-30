const locationShiftService = require("../services/locationShiftService");
const staffShiftService = require("../services/staffShiftService");

const createLocationShift = async (req, res) => {
  try {
    if (req.user && req.user.role === "manager") {
      const shift = await staffShiftService.getStaffShiftById(req.body.shift_id);
      if (shift && shift.role !== "CLEANER") {
        return res.status(403).json({ success: false, message: "Managers can only assign CLEANER shifts to locations" });
      }
    }

    const locationShift = await locationShiftService.createLocationShift(req.body);

    res.status(201).json({
      success: true,
      message: "Location shift created successfully",
      data: locationShift,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create location shift",
    });
  }
};

const getWorkingStaffByLocation = async (req, res) => {
  try {
    const result = await locationShiftService.getWorkingStaffByLocation(req.params.locationId, {
      target_date: req.query.target_date || req.query.work_date,
      role: req.query.role,
      include_assigned: req.query.include_assigned,
    });

    res.status(200).json({
      success: true,
      message: "Working staff retrieved successfully",
      ...result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve working staff",
    });
  }
};

const getAllLocationShifts = async (req, res) => {
  try {
    let query = { ...req.query };
    
    // Auto-filter by manager scope if requested by manager
    if (req.user && req.user.role === "manager") {
      if (req.managerScope && req.managerScope.locationIds) {
        query.location_ids = req.managerScope.locationIds.join(',');
      } else {
        return res.status(403).json({ success: false, message: "Out of management scope" });
      }
    }

    const shifts = await locationShiftService.getAllLocationShifts(query);
    res.status(200).json({
      success: true,
      count: shifts.length,
      data: shifts,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve location shifts",
    });
  }
};

const deleteLocationShift = async (req, res) => {
  try {
    const result = await locationShiftService.deleteLocationShift(req.params.id);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete location shift",
    });
  }
};

module.exports = {
  createLocationShift,
  getWorkingStaffByLocation,
  getAllLocationShifts,
  deleteLocationShift,
};
