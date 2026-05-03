const staffAttendanceLogService = require("../services/staffAttendanceLogService");

const getMyAttendanceLogs = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getMyAttendanceLogs({
      user: req.user,
      action: req.query.action,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      shift_id: req.query.shift_id,
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
    // Legacy support, now we use getMyTodayAttendanceStatus
    const result = await staffAttendanceLogService.getMyTodayAttendanceStatus({
      user: req.user,
      date: req.query.date,
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.status(200).json({
      success: true,
      message: "My attendance status retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve attendance status",
    });
  }
};

const getMyTodayAttendanceStatus = async (req, res) => {
  try {
    const result = await staffAttendanceLogService.getMyTodayAttendanceStatus({
      user: req.user,
      date: req.query.date,
    });

    // Prevent browser from caching this real-time status response
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
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
