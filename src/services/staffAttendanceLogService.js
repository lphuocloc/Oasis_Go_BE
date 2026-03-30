const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");

class StaffAttendanceLogService {
  resolveRequesterIds(user) {
    if (!user) {
      const error = new Error("User context is required");
      error.statusCode = 401;
      throw error;
    }

    const requesterIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    if (requesterIds.length === 0) {
      const error = new Error("Unable to resolve user id");
      error.statusCode = 400;
      throw error;
    }

    return requesterIds;
  }

  validateAction(action) {
    if (!action) {
      return null;
    }

    const normalized = String(action).trim().toUpperCase();
    const allowed = ["CHECKIN", "CHECKOUT"];
    if (!allowed.includes(normalized)) {
      const error = new Error(`Invalid action. Allowed values: ${allowed.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }

    return normalized;
  }

  applyDateRangeFilter(query, fromDateInput, toDateInput) {
    if (!fromDateInput && !toDateInput) {
      return;
    }

    query.created_at = {};

    if (fromDateInput) {
      const fromDate = new Date(fromDateInput);
      if (Number.isNaN(fromDate.getTime())) {
        const error = new Error("from_date must be a valid date (YYYY-MM-DD)");
        error.statusCode = 400;
        throw error;
      }
      fromDate.setHours(0, 0, 0, 0);
      query.created_at.$gte = fromDate;
    }

    if (toDateInput) {
      const toDate = new Date(toDateInput);
      if (Number.isNaN(toDate.getTime())) {
        const error = new Error("to_date must be a valid date (YYYY-MM-DD)");
        error.statusCode = 400;
        throw error;
      }
      toDate.setHours(23, 59, 59, 999);
      query.created_at.$lte = toDate;
    }
  }

  resolvePagination(pageInput, limitInput) {
    const page = Math.max(1, parseInt(pageInput, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(limitInput, 10) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  async getMyAttendanceLogs({ user, action, from_date, to_date, shift_assignment_id, page, limit }) {
    const requesterIds = this.resolveRequesterIds(user);
    const pagination = this.resolvePagination(page, limit);

    const query = {
      staff_id: { $in: requesterIds },
    };

    const normalizedAction = this.validateAction(action);
    if (normalizedAction) {
      query.action = normalizedAction;
    }

    if (shift_assignment_id) {
      query.shift_assignment_id = String(shift_assignment_id);
    }

    this.applyDateRangeFilter(query, from_date, to_date);

    const [logs, total] = await Promise.all([
      StaffAttendanceLog.find(query)
        .sort({ created_at: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      StaffAttendanceLog.countDocuments(query),
    ]);

    return {
      count: logs.length,
      data: logs,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getAttendanceLogs(filters = {}) {
    const query = {};
    const pagination = this.resolvePagination(filters.page, filters.limit);

    if (filters.staff_id) {
      query.staff_id = String(filters.staff_id);
    }

    if (filters.shift_assignment_id) {
      query.shift_assignment_id = String(filters.shift_assignment_id);
    }

    const normalizedAction = this.validateAction(filters.action);
    if (normalizedAction) {
      query.action = normalizedAction;
    }

    this.applyDateRangeFilter(query, filters.from_date, filters.to_date);

    const [logs, total] = await Promise.all([
      StaffAttendanceLog.find(query)
        .sort({ created_at: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      StaffAttendanceLog.countDocuments(query),
    ]);

    return {
      count: logs.length,
      data: logs,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getAttendanceLogById(id) {
    const attendanceLog = await StaffAttendanceLog.findOne({ id });

    if (!attendanceLog) {
      const error = new Error("Attendance log not found");
      error.statusCode = 404;
      throw error;
    }

    return attendanceLog;
  }

  async checkinWork({ shift_assignment_id, user }) {
    if (!shift_assignment_id) {
      const error = new Error("shift_assignment_id is required");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id }).lean();
    if (!assignment) {
      const error = new Error("Shift assignment not found");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = this.resolveRequesterIds(user);
    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("You are not allowed to check in this assignment");
      error.statusCode = 403;
      throw error;
    }

    if (assignment.status === "ABSENT") {
      const error = new Error(`Cannot check in assignment with status ${assignment.status}`);
      error.statusCode = 400;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    }).select("id").lean();

    if (existingCheckinLog) {
      const error = new Error("You have already checked in");
      error.statusCode = 400;
      throw error;
    }

    const log = await StaffAttendanceLog.create({
      staff_id: assignment.staff_id,
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    });

    return log;
  }

  async checkoutWork({ shift_assignment_id, user }) {
    if (!shift_assignment_id) {
      const error = new Error("shift_assignment_id is required");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id }).lean();
    if (!assignment) {
      const error = new Error("Shift assignment not found");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = this.resolveRequesterIds(user);
    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("You are not allowed to check out this assignment");
      error.statusCode = 403;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    }).select("id").lean();

    if (!existingCheckinLog) {
      const error = new Error("You must check in before check out");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckoutLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
    }).select("id").lean();

    if (existingCheckoutLog) {
      const error = new Error("You have already checked out");
      error.statusCode = 400;
      throw error;
    }

    const log = await StaffAttendanceLog.create({
      staff_id: assignment.staff_id,
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
    });

    return log;
  }
}

module.exports = new StaffAttendanceLogService();
