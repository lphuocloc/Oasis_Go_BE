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

const APP_TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Fixed +7 hours for Asia/Ho_Chi_Minh

const toStartOfDayInAppTz = (date) => {
  const d = new Date(date);
  const localMs = d.getTime() + APP_TZ_OFFSET_MS;
  // Floor to midnight in local time
  const localMidnightMs = localMs - (localMs % (24 * 60 * 60 * 1000));
  // Convert back to UTC
  return new Date(localMidnightMs - APP_TZ_OFFSET_MS);
};

const withTimeInAppTz = (baseDate, parts) => {
  // baseDate is guaranteed to be 00:00 local time
  const ms = baseDate.getTime() + (parts.hours * 60 * 60 * 1000) + (parts.minutes * 60 * 1000) + (parts.seconds * 1000);
  return new Date(ms);
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

    return toStartOfDayInAppTz(base);
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
        // Only set to 00:00:00 if the input is a simple date string (YYYY-MM-DD)
        if (String(fromDateInput).length <= 10) {
          fromDate.setHours(0, 0, 0, 0);
        }
        query.created_at.$gte = fromDate;
      }
    }

    if (toDateInput) {
      const toDate = new Date(toDateInput);
      if (!Number.isNaN(toDate.getTime())) {
        // Only set to end of day if the input is a simple date string
        if (String(toDateInput).length <= 10) {
          toDate.setHours(23, 59, 59, 999);
        }
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
    const now = date ? new Date(date) : new Date();
    const start = toStartOfDayInAppTz(now);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    // 1. Fetch all rosters to find if there is an active shift window RIGHT NOW
    let activeShiftId = null;
    let activeWorkDate = null;
    let activeLocationId = null;
    let canCheckin = false;

    const rosters = await StaffWorkRoster.find({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    for (const roster of rosters) {
      const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
      if (!shift) continue;
      try {
        const window = this.resolveShiftWindow(shift, now);
        // If we are within the allowed gate (checkinAllowedFrom to checkoutAllowedUntil)
        if (now >= window.checkinAllowedFrom && now <= window.checkoutAllowedUntil) {
          activeShiftId = shift.id;
          activeWorkDate = window.workDate;
          activeLocationId = roster.location_id;
          // can_checkin is true if shift hasn't ended yet
          if (now <= window.shiftEnd) {
            canCheckin = true;
          }
          break; 
        }
      } catch (e) { /* Not in window for this shift */ }
    }

    // 2. Fetch logs from the last 24 hours
    const lookbackLimit = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const logs = await StaffAttendanceLog.find({
      staff_id: { $in: requesterIds },
      created_at: { $gte: lookbackLimit, $lte: end }
    }).sort({ created_at: 1 }).lean();

    // 3. Determine "Relevant Logs" for the current status
    let relevantLogs = [];
    if (activeShiftId && activeWorkDate) {
      // If we are in an active shift window, prioritize logs for THAT specific work date and shift
      relevantLogs = logs.filter(l => 
        String(l.shift_id) === String(activeShiftId) && 
        l.work_date?.getTime() === activeWorkDate.getTime()
      );
    }

    // 4. Fallback: if no active shift, 
    // pick the most "urgent" session in the last 24h (prioritize unclosed ones)
    if (!activeShiftId && logs.length > 0) {
      const sessions = {};
      for (const log of logs) {
        const key = `${log.work_date?.toISOString() || 'no-date'}_${log.shift_id}`;
        if (!sessions[key]) sessions[key] = [];
        sessions[key].push(log);
      }
      
      const sessionKeys = Object.keys(sessions).sort().reverse(); 
      // Try to find the latest unclosed session first
      let selectedKey = sessionKeys[0];
      for (const key of sessionKeys) {
        const hasCheckin = sessions[key].some(l => l.action === 'CHECKIN');
        const hasCheckout = sessions[key].some(l => l.action === 'CHECKOUT');
        if (hasCheckin && !hasCheckout) {
          selectedKey = key;
          break;
        }
      }
      relevantLogs = sessions[selectedKey] || [];
    }

    const checkinLogs = relevantLogs.filter((item) => item.action === "CHECKIN");
    const checkoutLogs = relevantLogs.filter((item) => item.action === "CHECKOUT");
    const shiftIds = [...new Set(relevantLogs.map((item) => String(item.shift_id)))];

    let hasHandover = false;
    if (user.role === "manager") {
      const query = {
        manager_id: { $in: requesterIds }
      };

      if (activeShiftId && activeWorkDate) {
        query.shift_id = String(activeShiftId);
        query.work_date = activeWorkDate;
      } else if (shiftIds.length > 0 && checkinLogs.length > 0) {
        // Fallback to latest unclosed session's shift and work_date
        const latestLog = checkinLogs[checkinLogs.length - 1];
        query.shift_id = String(latestLog.shift_id);
        query.work_date = latestLog.work_date;
      } else {
        query._id = null; // No shift found, no handover possible
      }

      const handover = await ShiftHandoverLog.findOne(query).lean();
      hasHandover = !!handover;
    }

    // Calculate if the session is past its end time
    let isPastEnd = false;
    let shiftEndTime = null;
    if (checkinLogs.length > 0 && !checkoutLogs.length > 0) {
      const latestLog = checkinLogs[checkinLogs.length - 1];
      const s = await StaffShift.findOne({ id: latestLog.shift_id }).lean();
      if (s) {
        const startP = parseTimeParts(s.start_time);
        const endP = parseTimeParts(s.end_time);
        if (startP && endP) {
          const sStart = withTimeInAppTz(latestLog.work_date, startP);
          let sEnd = withTimeInAppTz(latestLog.work_date, endP);
          if (sEnd <= sStart) sEnd = new Date(sEnd.getTime() + 24 * 60 * 60 * 1000);
          isPastEnd = now > sEnd;
          shiftEndTime = sEnd.toISOString();
        }
      }
    }

    return {
      date: start.toISOString().slice(0, 10),
      checked_in_today: checkinLogs.length > 0,
      checked_out_today: checkoutLogs.length > 0,
      can_checkin: canCheckin,
      checkin_count: checkinLogs.length,
      checkout_count: checkoutLogs.length,
      latest_checkin_at: checkinLogs.length > 0 ? checkinLogs[checkinLogs.length - 1].created_at : null,
      latest_checkout_at: checkoutLogs.length > 0 ? checkoutLogs[checkoutLogs.length - 1].created_at : null,
      shift_ids: shiftIds,
      has_handover: hasHandover,
      active_shift_id: activeShiftId,
      active_work_date: activeWorkDate,
      active_location_id: activeLocationId,
      is_past_end: isPastEnd,
      shift_end_at: shiftEndTime,
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

    if (filters.location_id) {
      query.location_id = String(filters.location_id);
    }

    if (filters.cluster_id) {
      query.cluster_id = String(filters.cluster_id);
    }

    if (filters.date) {
      query.work_date = toStartOfDayInAppTz(filters.date);
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
        .populate("staff")
        .populate("cluster"),
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

  async checkinWork({ req, user }) {
    const requesterIds = this.resolveRequesterIds(user);
    const now = new Date();
    const clientIp = req?.ip || "unknown";
    const userAgent = req?.headers?.["user-agent"] || "unknown";

    console.log(`[AttendanceAudit] Check-in attempt by ${user.email} (ID: ${requesterIds[0]}) from IP: ${clientIp}, UA: ${userAgent}`);

    // Find ALL active rosters for this staff
    const rosters = await StaffWorkRoster.find({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    if (!rosters || rosters.length === 0) {
      const error = new Error("Khong tim thay thong tin phan cong (Roster)");
      error.statusCode = 404;
      throw error;
    }

    let activeRoster = null;
    let activeShift = null;
    let activeWindow = null;

    // Iterate through rosters to find the one whose shift matches current time
    for (const roster of rosters) {
      const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
      if (!shift) continue;

      try {
        const window = this.resolveShiftWindow(shift, now);
        if (now <= window.shiftEnd) {
          // If we got here, this shift is valid for current time
          activeRoster = roster;
          activeShift = shift;
          activeWindow = window;
          break;
        }
      } catch (e) {
        // Not in window for this shift, keep looking
        continue;
      }
    }

    if (!activeRoster || !activeShift) {
      const error = new Error("Ban khong co ca truc nao phu hop vao thoi diem nay");
      error.statusCode = 404;
      throw error;
    }

    const workDate = activeWindow.workDate;

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      shift_id: activeShift.id,
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


    try {
      const log = await StaffAttendanceLog.create({
        staff_id: requesterIds[0],
        shift_id: activeShift.id,
        location_id: activeRoster.location_id || null,
        cluster_id: activeRoster.cluster_id || null,
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

  async checkoutWork({ req, user }) {
    const requesterIds = this.resolveRequesterIds(user);
    const now = new Date();
    const clientIp = req?.ip || "unknown";
    const userAgent = req?.headers?.["user-agent"] || "unknown";
    const method = req?.method || "N/A";
    const url = req?.originalUrl || "N/A";

    console.log(`[AttendanceAudit] ${new Date().toISOString()} - CHECKOUT ATTEMPT by ${user.email}`);
    console.log(`[AttendanceAudit] Metadata: IP=${clientIp}, Method=${method}, URL=${url}, UA=${userAgent}`);

    if (!req) {
      console.warn(`[AttendanceAudit] WARNING: Checkout called without request object. Possible internal trigger.`);
    }

    // 1. Find the latest CHECKIN for this staff that doesn't have a CHECKOUT yet
    // We look back at recent sessions to find an "open" one.
    const recentCheckins = await StaffAttendanceLog.find({
      staff_id: { $in: requesterIds },
      action: "CHECKIN"
    }).sort({ created_at: -1 }).limit(5).lean();

    let latestCheckin = null;
    for (const checkin of recentCheckins) {
      const checkout = await StaffAttendanceLog.findOne({
        staff_id: checkin.staff_id,
        action: "CHECKOUT",
        work_date: checkin.work_date,
        shift_id: checkin.shift_id
      }).lean();

      if (!checkout) {
        latestCheckin = checkin;
        break;
      }
    }

    if (!latestCheckin) {
      const error = new Error("Ban can vao ca truoc khi tan ca (Hoac ban da tan ca cho tat ca cac phien gan day)");
      error.statusCode = 400;
      throw error;
    }

    // 2. Resolve the shift window to check if checkout is allowed
    const shift = await StaffShift.findOne({ id: latestCheckin.shift_id }).lean();
    if (!shift) {
      const error = new Error("Khong tim thay thong tin ca lam viec");
      error.statusCode = 404;
      throw error;
    }

    // 2. Resolve the shift window. 
    // We prioritize the window matching the latest checkin's work_date to allow late checkouts.
    let workDate = latestCheckin.work_date;
    let shiftEnd = null;

    try {
      const shiftWindow = this.resolveShiftWindow(shift, now);
      // If the current window matches our checkin's work date, use it
      if (shiftWindow.workDate.getTime() === workDate.getTime()) {
        shiftEnd = shiftWindow.shiftEnd;
      }
    } catch (e) {
      // If now is outside any window, we manually calculate the end for the checkin's work_date
      // This allows manual checkout even if late (e.g. forgot to checkout)
    }

    if (!shiftEnd) {
      const startParts = parseTimeParts(shift.start_time);
      const endParts = parseTimeParts(shift.end_time);
      if (!startParts || !endParts) {
        const error = new Error("Ca lam viec chua duoc cau hinh gio bat dau/ket thuc");
        error.statusCode = 400;
        throw error;
      }
      const shiftStart = withTimeInAppTz(workDate, startParts);
      shiftEnd = withTimeInAppTz(workDate, endParts);
      if (shiftEnd <= shiftStart) {
        shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    // 3. Enforce checkout ONLY after shift end (user request)
    if (now < shiftEnd) {
      const error = new Error(`Ban chi co the tan ca sau khi ca truc ket thuc (${shift.end_time})`);
      error.statusCode = 400;
      throw error;
    }

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
      // Require Handover Note created for THIS shift's work_date
      const handover = await ShiftHandoverLog.findOne({
        manager_id: { $in: requesterIds },
        shift_id: shift.id,
        work_date: workDate
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
        location_id: latestCheckin.location_id || null,
        cluster_id: latestCheckin.cluster_id || null,
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
    // Feature disabled as per user request to avoid accidental checkouts
    console.log("[StaffAttendance] Auto-checkout feature is currently disabled.");
    return;
  }
}

module.exports = new StaffAttendanceLogService();
