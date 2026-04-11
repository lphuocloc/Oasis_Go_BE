const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");

const CHECKIN_EARLY_MINUTES = 30;
const CHECKOUT_LATE_MINUTES = 180;

const toStartOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const parseTimeParts = (timeValue) => {
  const text = String(timeValue || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }

  return { hours, minutes, seconds };
};

const withTime = (baseDate, parts) => {
  const date = new Date(baseDate);
  date.setHours(parts.hours, parts.minutes, parts.seconds, 0);
  return date;
};

const formatDateTimeVi = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("vi-VN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDateYmd = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

class StaffAttendanceLogService {
  resolveWorkDate(inputDate) {
    const base = inputDate ? new Date(inputDate) : new Date();
    if (Number.isNaN(base.getTime())) {
      const error = new Error("date khong hop le, dinh dang dung la YYYY-MM-DD");
      error.statusCode = 400;
      throw error;
    }

    const workDate = new Date(base);
    workDate.setHours(0, 0, 0, 0);
    return workDate;
  }

  getWorkDateFromShiftWindow(shiftWindow) {
    return toStartOfDay(shiftWindow.shiftStart);
  }

  ensureRequestedWorkDateMatchesWindow(requestedDate, effectiveWorkDate) {
    if (!requestedDate) {
      return;
    }

    const requestedWorkDate = this.resolveWorkDate(requestedDate);
    if (requestedWorkDate.getTime() !== effectiveWorkDate.getTime()) {
      const requestedText = formatDateYmd(requestedWorkDate);
      const allowedText = formatDateYmd(effectiveWorkDate);
      const error = new Error(
        `Ngay ban dang thao tac (${requestedText}) khong dung voi ngay co the cham cong hien tai (${allowedText})`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  resolveDateRangeOfDay(inputDate) {
    const base = inputDate ? new Date(inputDate) : new Date();
    if (Number.isNaN(base.getTime())) {
      const error = new Error("date khong hop le, dinh dang dung la YYYY-MM-DD");
      error.statusCode = 400;
      throw error;
    }

    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  resolveShiftWindow(assignment, now = new Date()) {
    const startParts = parseTimeParts(assignment.start_time);
    const endParts = parseTimeParts(assignment.end_time);

    if (!startParts || !endParts) {
      const error = new Error("Ca lam viec chua duoc cau hinh gio bat dau/ket thuc");
      error.statusCode = 400;
      throw error;
    }

    const assignmentStartDay = toStartOfDay(assignment.start_date);
    const assignmentEndDay = toEndOfDay(assignment.end_date);
    const nowTime = now.getTime();

    const candidateDays = [
      toStartOfDay(now),
      new Date(toStartOfDay(now).getTime() - 24 * 60 * 60 * 1000),
    ];

    let selectedWindow = null;

    for (const day of candidateDays) {
      if (day < assignmentStartDay || day > assignmentEndDay) {
        continue;
      }

      const shiftStart = withTime(day, startParts);
      let shiftEnd = withTime(day, endParts);
      if (shiftEnd <= shiftStart) {
        shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const gateStart = new Date(shiftStart.getTime() - CHECKIN_EARLY_MINUTES * 60 * 1000);
      const gateEnd = new Date(shiftEnd.getTime() + CHECKOUT_LATE_MINUTES * 60 * 1000);

      if (nowTime >= gateStart.getTime() && nowTime <= gateEnd.getTime()) {
        selectedWindow = {
          shiftStart,
          shiftEnd,
          checkinAllowedFrom: gateStart,
          checkoutAllowedUntil: gateEnd,
        };
        break;
      }
    }

    if (selectedWindow) {
      return selectedWindow;
    }

    const error = new Error(
      "Thoi diem hien tai nam ngoai khung gio cho phep vao ca/tan ca"
    );
    error.statusCode = 400;
    throw error;
  }

  ensureAssignmentStatusForCheckin(status) {
    if (status !== "ASSIGNED") {
      const error = new Error(`Khong the vao ca khi phan cong dang o trang thai ${status}`);
      error.statusCode = 400;
      throw error;
    }
  }

  ensureAssignmentStatusForCheckout(status) {
    const allowed = ["ASSIGNED", "COMPLETED"];
    if (!allowed.includes(status)) {
      const error = new Error(`Khong the tan ca khi phan cong dang o trang thai ${status}`);
      error.statusCode = 400;
      throw error;
    }
  }

  resolveRequesterIds(user) {
    if (!user) {
      const error = new Error("Khong tim thay thong tin nguoi dung");
      error.statusCode = 401;
      throw error;
    }

    const requesterIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    if (requesterIds.length === 0) {
      const error = new Error("Khong xac dinh duoc ID nguoi dung");
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
      const error = new Error(`action khong hop le. Chi chap nhan: ${allowed.join(", ")}`);
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
        const error = new Error("from_date khong hop le, dinh dang dung la YYYY-MM-DD");
        error.statusCode = 400;
        throw error;
      }
      fromDate.setHours(0, 0, 0, 0);
      query.created_at.$gte = fromDate;
    }

    if (toDateInput) {
      const toDate = new Date(toDateInput);
      if (Number.isNaN(toDate.getTime())) {
        const error = new Error("to_date khong hop le, dinh dang dung la YYYY-MM-DD");
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

  async getMyAssignmentAttendanceStatus({ user, shift_assignment_id, date }) {
    if (!shift_assignment_id) {
      const error = new Error("Thieu shift_assignment_id");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: String(shift_assignment_id) }).lean();
    if (!assignment) {
      const error = new Error("Khong tim thay phan cong ca");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = this.resolveRequesterIds(user);
    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("Ban khong co quyen xem phan cong ca nay");
      error.statusCode = 403;
      throw error;
    }

    const workDate = this.resolveWorkDate(date);

    const [checkinLog, checkoutLog] = await Promise.all([
      StaffAttendanceLog.findOne({
        shift_assignment_id: assignment.id,
        action: "CHECKIN",
        work_date: workDate,
      })
        .sort({ created_at: 1 })
        .select("id created_at work_date")
        .lean(),
      StaffAttendanceLog.findOne({
        shift_assignment_id: assignment.id,
        action: "CHECKOUT",
        work_date: workDate,
      })
        .sort({ created_at: 1 })
        .select("id created_at work_date")
        .lean(),
    ]);

    return {
      shift_assignment_id: assignment.id,
      date: workDate.toISOString().slice(0, 10),
      checked_in: Boolean(checkinLog),
      checked_out: Boolean(checkoutLog),
      checkin_at: checkinLog ? checkinLog.created_at : null,
      checkout_at: checkoutLog ? checkoutLog.created_at : null,
    };
  }

  async getMyTodayAttendanceStatus({ user, date }) {
    const requesterIds = this.resolveRequesterIds(user);
    const { start, end } = this.resolveDateRangeOfDay(date);
    const workDate = this.resolveWorkDate(date);

    const logs = await StaffAttendanceLog.find({
      staff_id: { $in: requesterIds },
      $or: [
        { work_date: workDate },
        { work_date: { $exists: false }, created_at: { $gte: start, $lte: end } },
      ],
    })
      .sort({ created_at: 1 })
      .select("id shift_assignment_id action created_at work_date")
      .lean();

    const checkinLogs = logs.filter((item) => item.action === "CHECKIN");
    const checkoutLogs = logs.filter((item) => item.action === "CHECKOUT");

    return {
      date: start.toISOString().slice(0, 10),
      checked_in_today: checkinLogs.length > 0,
      checked_out_today: checkoutLogs.length > 0,
      checkin_count: checkinLogs.length,
      checkout_count: checkoutLogs.length,
      latest_checkin_at: checkinLogs.length > 0 ? checkinLogs[checkinLogs.length - 1].created_at : null,
      latest_checkout_at: checkoutLogs.length > 0 ? checkoutLogs[checkoutLogs.length - 1].created_at : null,
      checkin_assignment_ids: [...new Set(checkinLogs.map((item) => String(item.shift_assignment_id)))],
      checkout_assignment_ids: [...new Set(checkoutLogs.map((item) => String(item.shift_assignment_id)))],
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
      const error = new Error("Khong tim thay ban ghi cham cong");
      error.statusCode = 404;
      throw error;
    }

    return attendanceLog;
  }

  async checkinWork({ shift_assignment_id, user, date }) {
    if (!shift_assignment_id) {
      const error = new Error("Thieu shift_assignment_id");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id }).lean();
    if (!assignment) {
      const error = new Error("Khong tim thay phan cong ca");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = this.resolveRequesterIds(user);
    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("Ban khong co quyen vao ca cho phan cong nay");
      error.statusCode = 403;
      throw error;
    }

    this.ensureAssignmentStatusForCheckin(assignment.status);

    const shiftWindow = this.resolveShiftWindow(assignment, new Date());
    const workDate = this.getWorkDateFromShiftWindow(shiftWindow);
    this.ensureRequestedWorkDateMatchesWindow(date, workDate);
    const now = new Date();
    if (now < shiftWindow.checkinAllowedFrom || now > shiftWindow.shiftEnd) {
      const error = new Error("Chi duoc vao ca tu 30 phut truoc gio bat dau den het gio ket thuc ca");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
      work_date: workDate,
    }).select("id created_at").lean();

    if (existingCheckinLog) {
      const checkedInAt = formatDateTimeVi(existingCheckinLog.created_at);
      const error = new Error(
        checkedInAt
          ? `Ban da vao ca truoc do luc ${checkedInAt}`
          : "Ban da vao ca truoc do"
      );
      error.statusCode = 400;
      throw error;
    }

    let log;
    try {
      log = await StaffAttendanceLog.create({
        staff_id: assignment.staff_id,
        shift_assignment_id: assignment.id,
        action: "CHECKIN",
        work_date: workDate,
      });
    } catch (createError) {
      if (createError && createError.code === 11000) {
        const error = new Error("Ban da vao ca truoc do");
        error.statusCode = 400;
        throw error;
      }
      throw createError;
    }

    return log;
  }

  async checkoutWork({ shift_assignment_id, user, date }) {
    if (!shift_assignment_id) {
      const error = new Error("Thieu shift_assignment_id");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id }).lean();
    if (!assignment) {
      const error = new Error("Khong tim thay phan cong ca");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = this.resolveRequesterIds(user);
    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("Ban khong co quyen tan ca cho phan cong nay");
      error.statusCode = 403;
      throw error;
    }

    this.ensureAssignmentStatusForCheckout(assignment.status);

    const shiftWindow = this.resolveShiftWindow(assignment, new Date());
    const workDate = this.getWorkDateFromShiftWindow(shiftWindow);
    this.ensureRequestedWorkDateMatchesWindow(date, workDate);
    const now = new Date();
    if (now < shiftWindow.shiftStart || now > shiftWindow.checkoutAllowedUntil) {
      const error = new Error("Chi duoc tan ca trong thoi gian ca va toi da 180 phut sau khi ket thuc ca");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
      work_date: workDate,
    }).select("id created_at").lean();

    if (!existingCheckinLog) {
      const error = new Error("Ban can vao ca truoc khi tan ca");
      error.statusCode = 400;
      throw error;
    }

    if (new Date(existingCheckinLog.created_at).getTime() > now.getTime()) {
      const error = new Error("Du lieu cham cong khong hop le: tan ca khong the xay ra truoc vao ca");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckoutLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
      work_date: workDate,
    }).select("id created_at").lean();

    if (existingCheckoutLog) {
      const checkedOutAt = formatDateTimeVi(existingCheckoutLog.created_at);
      const error = new Error(
        checkedOutAt
          ? `Ban da tan ca truoc do luc ${checkedOutAt}`
          : "Ban da tan ca truoc do"
      );
      error.statusCode = 400;
      throw error;
    }

    let log;
    try {
      log = await StaffAttendanceLog.create({
        staff_id: assignment.staff_id,
        shift_assignment_id: assignment.id,
        action: "CHECKOUT",
        work_date: workDate,
      });
    } catch (createError) {
      if (createError && createError.code === 11000) {
        const error = new Error("Ban da tan ca truoc do");
        error.statusCode = 400;
        throw error;
      }
      throw createError;
    }

    return log;
  }
}

module.exports = new StaffAttendanceLogService();
