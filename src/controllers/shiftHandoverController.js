const shiftHandoverService = require("../services/shiftHandoverService");

const createHandover = async (req, res) => {
  try {
    const result = await shiftHandoverService.createHandover({
      user: req.user,
      note_text: req.body.note_text,
    });

    res.status(201).json({
      success: true,
      message: "Handover note created successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create handover note",
    });
  }
};

const getRecentHandovers = async (req, res) => {
  try {
    let locationIds = [];
    if (req.user && req.user.role === "manager" && req.managerScope && req.managerScope.locationIds) {
      locationIds = req.managerScope.locationIds;
    } else if (req.query.location_ids) {
      locationIds = req.query.location_ids.split(",");
    }

    const staffAttendanceLogService = require("../services/staffAttendanceLogService");
    const status = await staffAttendanceLogService.getMyTodayAttendanceStatus({ user: req.user });

    let currentShiftId = status.active_shift_id;
    let activeLocationId = status.active_location_id;

    // If manager is currently on duty at a specific location, ONLY show that location's handovers
    if (activeLocationId) {
      locationIds = [activeLocationId];
    }

    const result = await shiftHandoverService.getRecentHandovers({
      location_ids: locationIds,
      limit: activeLocationId ? 1 : (req.query.limit || 5),
      current_shift_id: activeLocationId ? currentShiftId : null,
    });

    res.status(200).json({
      success: true,
      message: "Recent handovers retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve recent handovers",
    });
  }
};

module.exports = {
  createHandover,
  getRecentHandovers,
};
