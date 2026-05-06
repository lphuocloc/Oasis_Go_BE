const ShiftHandoverLog = require("../models/ShiftHandoverLog");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const StaffShift = require("../models/StaffShift");

class ShiftHandoverService {
  async createHandover({ user, note_text }) {
    if (!user || user.role !== "manager") {
      const error = new Error("Only managers can create handover notes");
      error.statusCode = 403;
      throw error;
    }

    if (!note_text || String(note_text).trim() === "") {
      const error = new Error("Handover note text is required");
      error.statusCode = 400;
      throw error;
    }

    const requesterIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    // Find ALL active rosters for manager
    const rosters = await StaffWorkRoster.find({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    if (!rosters || rosters.length === 0) {
      const error = new Error("Manager is not assigned to any active roster");
      error.statusCode = 404;
      throw error;
    }

    const staffAttendanceLogService = require("./staffAttendanceLogService");
    const now = new Date();
    let activeRoster = null;
    let activeShift = null;

    const StaffAttendanceLog = require("../models/StaffAttendanceLog");
    const latestCheckin = await StaffAttendanceLog.findOne({
      staff_id: { $in: requesterIds },
      action: "CHECKIN"
    }).sort({ created_at: -1 }).lean();

    let workDate = null;

    if (latestCheckin) {
      const hasCheckout = await StaffAttendanceLog.findOne({
        staff_id: latestCheckin.staff_id,
        action: "CHECKOUT",
        work_date: latestCheckin.work_date,
        shift_id: latestCheckin.shift_id
      }).lean();

      if (!hasCheckout) {
        // We found an open session! Use it.
        activeRoster = rosters.find(r => String(r.shift_id) === String(latestCheckin.shift_id));
        if (activeRoster) {
          activeShift = await StaffShift.findOne({ id: latestCheckin.shift_id }).lean();
          workDate = latestCheckin.work_date;
        }
      }
    }

    // Fallback to standard window matching if no open session or if open session roster not found
    if (!activeRoster || !activeShift) {
      for (const roster of rosters) {
        const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
        if (!shift) continue;

        try {
          const window = staffAttendanceLogService.resolveShiftWindow(shift, now);
          activeRoster = roster;
          activeShift = shift;
          workDate = window.workDate;
          break;
        } catch (e) {
          continue;
        }
      }
    }

    if (!activeRoster || !activeShift || !workDate) {
      const error = new Error("Khong tim thay ca truc phu hop de ban giao vao luc này. Vui long kiem tra lai trang thai check-in.");
      error.statusCode = 404;
      throw error;
    }

    const log = await ShiftHandoverLog.create({
      manager_id: requesterIds[0],
      location_id: activeRoster.location_id,
      shift_id: activeShift.id,
      note_text: String(note_text).trim(),
      work_date: workDate,
    });

    return log;
  }

  async getRecentHandovers({ location_ids, limit = 5, current_shift_id = null }) {
    if (!location_ids || location_ids.length === 0) {
      return [];
    }

    const now = new Date();
    const lookbackLimit = new Date(now.getTime() - 18 * 60 * 60 * 1000);

    const query = {
      location_id: { $in: location_ids },
      created_at: { $gte: lookbackLimit }
    };
    
    // If we are looking for a "previous" shift handover while currently in a shift
    if (current_shift_id) {
      query.shift_id = { $ne: current_shift_id };
    }

    const logs = await ShiftHandoverLog.find(query)
    .sort({ created_at: -1 })
    .limit(Number(limit))
    .populate("manager", "name email")
    .populate("shift", "shift_name")
    .lean();

    return logs;
  }
}

module.exports = new ShiftHandoverService();
