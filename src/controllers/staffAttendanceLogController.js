const staffAttendanceLogService = require("../services/staffAttendanceLogService");

const getMyAttendanceLogs = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getMyAttendanceLogs({
      user: req.user,
      action: req.query.action,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      shift_assignment_id: req.query.shift_assignment_id,
      page: req.query.page,
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      message: "My attendance logs retrieved successfully",
      ...result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve my attendance logs",
    });
  }
};

const getMyAssignmentAttendanceStatus = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getMyAssignmentAttendanceStatus({
      user: req.user,
      shift_assignment_id: req.query.shift_assignment_id,
      date: req.query.date,
    });

    res.status(200).json({
      success: true,
      message: "My assignment attendance status retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve assignment attendance status",
    });
  }
};

const getMyTodayAttendanceStatus = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getMyTodayAttendanceStatus({
      user: req.user,
      date: req.query.date,
    });

    res.status(200).json({
      success: true,
      message: "My daily attendance status retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve daily attendance status",
    });
  }
};

const getAttendanceLogs = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getAttendanceLogs(req.query);

    res.status(200).json({
      success: true,
      count: result.count,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve attendance logs",
    });
  }
};

const getAttendanceLogById = async (req, res) => {
  try {
    const log = await staffAttendanceLogService.getAttendanceLogById(req.params.id);

    if (req.user && req.user.role === "cleaner") {
      const requesterIds = [
        req.user && req.user.id ? String(req.user.id) : null,
        req.user && req.user._id ? String(req.user._id) : null,
      ].filter(Boolean);

      if (!requesterIds.includes(String(log.staff_id))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to access this attendance log",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: log,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve attendance log",
    });
  }
};

const checkinWork = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.checkinWork({
      shift_assignment_id: req.body.shift_assignment_id,
      date: req.body.date,
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
    const result = await staffAttendanceLogService.checkoutWork({
      shift_assignment_id: req.body.shift_assignment_id,
      date: req.body.date,
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
  getMyAttendanceLogs,
  getMyAssignmentAttendanceStatus,
  getMyTodayAttendanceStatus,
  getAttendanceLogs,
  getAttendanceLogById,
  checkinWork,
  checkoutWork,
};
