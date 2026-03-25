const locationShiftService = require("../services/locationShiftService");

const createLocationShift = async (req, res) => {
  try {
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

module.exports = {
  createLocationShift,
  getWorkingStaffByLocation,
};
