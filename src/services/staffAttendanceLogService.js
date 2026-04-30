const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const StaffShift = require("../models/StaffShift");
const ShiftHandoverLog = require("../models/ShiftHandoverLog");
const CleaningTask = require("../models/CleaningTask");
const User = require("../models/User");

const CHECKIN_EARLY_MINUTES = 30;
const CHECKOUT_LATE_MINUTES = 180;
const APP_LOCALE = process.env.APP_LOCALE || "vi-VN";
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";

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
  const match = text.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
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

const getAppTzOffsetMs = (date) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map(({ type, value }) => [type, value])
  );
  const localAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return localAsUtcMs - date.getTime();
};

const toStartOfDayInAppTz = (date) => {
  const offsetMs = getAppTzOffsetMs(date);
  const localMs = date.getTime() + offsetMs;
  const localMidnightMs = localMs - (localMs % (24 * 60 * 60 * 1000));
  return new Date(localMidnightMs - offsetMs);
};

const withTimeInAppTz = (baseDate, parts) => {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(baseDate);

  const hh = String(parts.hours).padStart(2, "0");
  const mm = String(parts.minutes).padStart(2, "0");
  const ss = String(parts.seconds).padStart(2, "0");

  const naiveMs = Date.parse(`${dateStr}T${hh}:${mm}:${ss}Z`);
  const offsetMs = getAppTzOffsetMs(new Date(naiveMs));
  return new Date(naiveMs - offsetMs);
};

const formatDateTimeVi = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatOptions = {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: APP_TIMEZONE,
  };

  try {
    return date.toLocaleString(APP_LOCALE, formatOptions);
  } catch (error) {
    return date.toLocaleString("vi-VN", {
      ...formatOptions,
      timeZone: "UTC",
    });
  }
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

  resolveShiftWindow(shift, now = new Date()) {
    const startParts = parseTimeParts(shift.start_time);
    const endParts = parseTimeParts(shift.end_time);

    if (!startParts || !endParts) {
      const error = new Error("Ca lam viec chua duoc cau hinh gio bat dau/ket thuc");
      error.statusCode = 400;
      throw error;
    }

    const nowTime = now.getTime();
    const todayInAppTz = toStartOfDayInAppTz(now);
    const candidateDays = [
      todayInAppTz,
      new Date(todayInAppTz.getTime() - 24 * 60 * 60 * 1000),
    ];

    let selectedWindow = null;

    for (const day of candidateDays) {
      const shiftStart = withTimeInAppTz(day, startParts);
      let shiftEnd = withTimeInAppTz(day, endParts);
      if (shiftEnd <= shiftStart) {
        shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const gateStart = new Date(shiftStart.getTime() - CHECKIN_EARLY_MINUTES * 60 * 1000);
      const gateEnd = new Date(shiftEnd.getTime() + CHECKOUT_LATE_MINUTES * 60 * 1000);

      if (nowTime >= gateStart.getTime() && nowTime <= gateEnd.getTime()) {
        selectedWindow = {
          workDate: day,
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
      if (!Number.isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        query.created_at.$gte = fromDate;
      }
    }

    if (toDateInput) {
      const toDate = new Date(toDateInput);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        query.created_at.$lte = toDate;
      }
    }
  }

  resolvePagination(pageInput, limitInput) {
    const page = Math.max(1, parseInt(pageInput, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(limitInput, 10) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  async getMyAttendanceLogs({ user, action, from_date, to_date, shift_id, page, limit }) {
    const requesterIds = this.resolveRequesterIds(user);
    const pagination = this.resolvePagination(page, limit);

    const query = {
      staff_id: { $in: requesterIds },
    };

    const normalizedAction = this.validateAction(action);
    if (normalizedAction) {
      query.action = normalizedAction;
    }

    if (shift_id) {
      query.shift_id = String(shift_id);
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

  async getMyTodayAttendanceStatus({ user, date }) {
    const requesterIds = this.resolveRequesterIds(user);
    const workDate = this.resolveWorkDate(date);
    const start = new Date(workDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(workDate);
    end.setHours(23, 59, 59, 999);

    const logs = await StaffAttendanceLog.find({
      staff_id: { $in: requesterIds },
      $or: [
        { work_date: workDate },
        { work_date: { $exists: false }, created_at: { $gte: start, $lte: end } },
      ],
    })
      .sort({ created_at: 1 })
      .select("id shift_id action created_at work_date")
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
      shift_ids: [...new Set(logs.map((item) => String(item.shift_id)))],
    };
  }

  async getAttendanceLogs(filters = {}) {
    const query = {};
    const pagination = this.resolvePagination(filters.page, filters.limit);

    if (filters.staff_id) {
      query.staff_id = String(filters.staff_id);
    }

    if (filters.shift_id) {
      query.shift_id = String(filters.shift_id);
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

  async checkinWork({ user }) {
    const requesterIds = this.resolveRequesterIds(user);
    
    // Find active roster
    const roster = await StaffWorkRoster.findOne({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    if (!roster) {
      const error = new Error("Khong tim thay thong tin phan cong (Roster)");
      error.statusCode = 404;
      throw error;
    }

    const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
    if (!shift) {
      const error = new Error("Khong tim thay thong tin ca lam viec");
      error.statusCode = 404;
      throw error;
    }

    const shiftWindow = this.resolveShiftWindow(shift, new Date());
    const workDate = shiftWindow.workDate;

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      shift_id: shift.id,
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

    // Lazy checkout previous manager if they forgot
    if (user.role === "manager" && roster.location_id) {
        const previousManagerCheckin = await StaffAttendanceLog.findOne({
            location_id: roster.location_id,
            action: "CHECKIN",
            staff_id: { $nin: requesterIds }
        }).sort({ created_at: -1 }).lean();

        if (previousManagerCheckin) {
            const hasCheckedOut = await StaffAttendanceLog.findOne({
                staff_id: previousManagerCheckin.staff_id,
                action: "CHECKOUT",
                work_date: previousManagerCheckin.work_date,
                shift_id: previousManagerCheckin.shift_id
            }).lean();

            if (!hasCheckedOut) {
                // Force checkout previous manager
                await StaffAttendanceLog.create({
                    staff_id: previousManagerCheckin.staff_id,
                    shift_id: previousManagerCheckin.shift_id,
                    location_id: previousManagerCheckin.location_id,
                    cluster_id: previousManagerCheckin.cluster_id,
                    action: "CHECKOUT",
                    work_date: previousManagerCheckin.work_date,
                });
            }
        }
    }

    try {
      const log = await StaffAttendanceLog.create({
        staff_id: requesterIds[0],
        shift_id: shift.id,
        location_id: roster.location_id || null,
        cluster_id: roster.cluster_id || null,
        action: "CHECKIN",
        work_date: workDate,
      });
      return log;
    } catch (createError) {
      if (createError && createError.code === 11000) {
        const error = new Error("Ban da vao ca truoc do");
        error.statusCode = 400;
        throw error;
      }
      throw createError;
    }
  }

  async checkoutWork({ user }) {
    const requesterIds = this.resolveRequesterIds(user);
    
    // Find active roster
    const roster = await StaffWorkRoster.findOne({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    if (!roster) {
      const error = new Error("Khong tim thay thong tin phan cong (Roster)");
      error.statusCode = 404;
      throw error;
    }

    const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
    if (!shift) {
      const error = new Error("Khong tim thay thong tin ca lam viec");
      error.statusCode = 404;
      throw error;
    }

    const shiftWindow = this.resolveShiftWindow(shift, new Date());
    const workDate = shiftWindow.workDate;
    const now = new Date();

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      shift_id: shift.id,
      action: "CHECKIN",
      work_date: workDate,
    }).select("id created_at").lean();

    if (!existingCheckinLog) {
      const error = new Error("Ban can vao ca truoc khi tan ca");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckoutLog = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      shift_id: shift.id,
      action: "CHECKOUT",
      work_date: workDate,
    }).select("id created_at").lean();

    if (existingCheckoutLog) {
      const error = new Error("Ban da tan ca truoc do");
      error.statusCode = 400;
      throw error;
    }

    if (user.role === "cleaner") {
      // Must complete ongoing cleaning tasks
      const ongoingTask = await CleaningTask.findOne({
          cleaner_id: { $in: requesterIds },
          status: "IN_PROGRESS"
      }).lean();
      
      if (ongoingTask) {
          const error = new Error("Vui long hoan thanh cong viec don dep dang dang do truoc khi ket thuc ca");
          error.statusCode = 400;
          throw error;
      }
    }

    if (user.role === "manager") {
      // Require Handover Note created today
      const startOfToday = toStartOfDay(now);
      const handover = await ShiftHandoverLog.findOne({
          manager_id: { $in: requesterIds },
          shift_id: shift.id,
          created_at: { $gte: startOfToday }
      }).lean();

      if (!handover) {
          const error = new Error("Vui long ghi chu ban giao ca truoc khi tan ca");
          error.statusCode = 400;
          throw error;
      }
    }

    try {
      const log = await StaffAttendanceLog.create({
        staff_id: requesterIds[0],
        shift_id: shift.id,
        location_id: roster.location_id || null,
        cluster_id: roster.cluster_id || null,
        action: "CHECKOUT",
        work_date: workDate,
      });
      return log;
    } catch (createError) {
      if (createError && createError.code === 11000) {
        const error = new Error("Ban da tan ca truoc do");
        error.statusCode = 400;
        throw error;
      }
      throw createError;
    }
  }

  async autoCheckoutGhostSessions() {
    console.log("[StaffAttendance] Running auto-checkout for ghost sessions...");
    try {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 14 * 60 * 60 * 1000); // 14 hours ago
      
      // Find all CHECKIN logs older than 14 hours
      const oldCheckins = await StaffAttendanceLog.find({
          action: "CHECKIN",
          created_at: { $lt: cutoffTime }
      }).lean();
      
      let checkedOutCount = 0;
      
      for (const checkin of oldCheckins) {
          // Check if there is already a CHECKOUT for this staff and work_date
          const hasCheckout = await StaffAttendanceLog.exists({
              staff_id: checkin.staff_id,
              action: "CHECKOUT",
              work_date: checkin.work_date
          });
          
          if (!hasCheckout) {
              await StaffAttendanceLog.create({
                  staff_id: checkin.staff_id,
                  shift_id: checkin.shift_id,
                  location_id: checkin.location_id,
                  cluster_id: checkin.cluster_id,
                  action: "CHECKOUT",
                  work_date: checkin.work_date,
                  created_at: new Date(checkin.created_at.getTime() + 8 * 60 * 60 * 1000) // fake checkout 8 hours later
              });
              checkedOutCount++;
          }
      }
      
      if (checkedOutCount > 0) {
          console.log(`[StaffAttendance] Auto-checked out ${checkedOutCount} ghost sessions.`);
      }
    } catch (error) {
      console.error("[StaffAttendance] Failed to run ghost session cleanup:", error);
    }
  }
}

module.exports = new StaffAttendanceLogService();
