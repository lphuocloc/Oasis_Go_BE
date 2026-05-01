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
  const d = new Date(date);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  
  // Format as YYYY-MM-DDT00:00:00 in Local Time, then convert to Date
  // To get exactly 00:00:00 in Asia/Ho_Chi_Minh:
  const naiveIso = `${dateStr}T00:00:00`;
  const localDate = new Date(naiveIso); 
  
  // If we want it represented as local midnight (which is 17:00 UTC previous day):
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  });
  
  const parts = Object.fromEntries(fmt.formatToParts(localDate).map(p => [p.type, p.value]));
  const offsetMs = Date.UTC(parts.year, parts.month-1, parts.day, parts.hour==='24'?0:parts.hour, parts.minute, parts.second) - localDate.getTime();
  
  return new Date(localDate.getTime() - offsetMs);
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
    const now = date ? new Date(date) : new Date();
    const start = toStartOfDayInAppTz(now);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    // CRITICAL FIX: Only look at logs from the last 24 hours to determine CURRENT status.
    // We don't want "zombie" sessions from days ago to affect the UI.
    const lookbackLimit = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const logs = await StaffAttendanceLog.find({
      staff_id: { $in: requesterIds },
      created_at: { $gte: lookbackLimit, $lte: end }
    }).sort({ created_at: 1 }).lean();

    // Group logs by work_date + shift_id to find the "current" active session
    const sessions = {};
    for (const log of logs) {
      const key = `${log.work_date?.toISOString() || 'no-date'}_${log.shift_id}`;
      if (!sessions[key]) sessions[key] = [];
      sessions[key].push(log);
    }

    // CRITICAL: We only care about the ABSOLUTE LATEST session in the last 24h.
    // If it's finished, it's finished. Don't look for old unfinished ones.
    const sessionKeys = Object.keys(sessions).sort().reverse(); 
    const bestKey = sessionKeys[0]; 

    const relevantLogs = sessions[bestKey] || [];

    const checkinLogs = relevantLogs.filter((item) => item.action === "CHECKIN");
    const checkoutLogs = relevantLogs.filter((item) => item.action === "CHECKOUT");
    const shiftIds = [...new Set(relevantLogs.map((item) => String(item.shift_id)))];

    let hasHandover = false;
    if (user.role === "manager" && shiftIds.length > 0) {
      const handover = await ShiftHandoverLog.findOne({
        manager_id: { $in: requesterIds },
        shift_id: { $in: shiftIds },
        created_at: { $gte: lookbackLimit }
      }).lean();
      hasHandover = !!handover;
    }

    // NEW: Check if there's any shift available for check-in RIGHT NOW
    let canCheckin = false;
    const rosters = await StaffWorkRoster.find({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    for (const roster of rosters) {
      const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
      if (!shift) continue;
      try {
        this.resolveShiftWindow(shift, now);
        canCheckin = true;
        break;
      } catch (e) { /* Not in window */ }
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
    const now = new Date();

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
        // If we got here, this shift is valid for current time
        activeRoster = roster;
        activeShift = shift;
        activeWindow = window;
        break;
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

    // Lazy checkout previous manager if they forgot
    if (user.role === "manager" && activeRoster.location_id) {
      const previousManagerCheckin = await StaffAttendanceLog.findOne({
        location_id: activeRoster.location_id,
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

  async checkoutWork({ user }) {
    const requesterIds = this.resolveRequesterIds(user);
    const now = new Date();

    // 1. Find the latest CHECKIN for this staff that doesn't have a CHECKOUT yet
    const latestCheckin = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      action: "CHECKIN"
    }).sort({ created_at: -1 }).lean();

    if (!latestCheckin) {
      const error = new Error("Ban can vao ca truoc khi tan ca");
      error.statusCode = 400;
      throw error;
    }

    // Check if already checked out for this specific checkin
    const alreadyCheckedOut = await StaffAttendanceLog.findOne({
      staff_id: latestCheckin.staff_id,
      action: "CHECKOUT",
      work_date: latestCheckin.work_date,
      shift_id: latestCheckin.shift_id
    }).lean();

    if (alreadyCheckedOut) {
      const error = new Error("Ban da tan ca truoc do");
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

    const shiftWindow = this.resolveShiftWindow(shift, now);
    const workDate = shiftWindow.workDate;
    const shiftEnd = shiftWindow.shiftEnd;

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
    console.log("[StaffAttendance] Running auto-checkout for ghost sessions...");
    try {
      const now = new Date();

      // Find all CHECKIN logs in the last 24 hours
      const cutoffStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const activeCheckins = await StaffAttendanceLog.find({
        action: "CHECKIN",
        created_at: { $gt: cutoffStart }
      }).lean();

      let checkedOutCount = 0;

      for (const checkin of activeCheckins) {
        // 1. Check if already has a CHECKOUT
        const hasCheckout = await StaffAttendanceLog.exists({
          staff_id: checkin.staff_id,
          action: "CHECKOUT",
          work_date: checkin.work_date,
          shift_id: checkin.shift_id
        });

        if (hasCheckout) continue;

        // 2. Get shift details to see when it ended
        const shift = await StaffShift.findOne({ id: checkin.shift_id }).lean();
        if (!shift) continue;

        try {
          // Get the actual end time for this shift on its work_date
          const startParts = parseTimeParts(shift.start_time);
          const endParts = parseTimeParts(shift.end_time);
          if (!startParts || !endParts) continue;

          let shiftEnd = withTimeInAppTz(checkin.work_date, endParts);
          if (shiftEnd <= withTimeInAppTz(checkin.work_date, startParts)) {
            shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
          }

          // Auto checkout if 30 minutes past shift end
          const autoCheckoutTime = new Date(shiftEnd.getTime() + 30 * 60 * 1000);

          if (now >= autoCheckoutTime) {
            await StaffAttendanceLog.create({
              staff_id: checkin.staff_id,
              shift_id: checkin.shift_id,
              location_id: checkin.location_id,
              cluster_id: checkin.cluster_id,
              action: "CHECKOUT",
              work_date: checkin.work_date,
              created_at: autoCheckoutTime // Record it as checked out exactly at the threshold
            });
            checkedOutCount++;
          }
        } catch (err) {
          console.error(`[StaffAttendance] Error processing auto-checkout for log ${checkin.id}:`, err);
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
