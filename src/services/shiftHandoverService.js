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

    // Find active roster for manager
    const roster = await StaffWorkRoster.findOne({ staff_id: { $in: requesterIds }, is_active: true }).lean();
    if (!roster || !roster.location_id) {
      const error = new Error("Manager is not assigned to any active location");
      error.statusCode = 404;
      throw error;
    }

    const shift = await StaffShift.findOne({ id: roster.shift_id }).lean();
    if (!shift) {
      const error = new Error("Assigned shift not found");
      error.statusCode = 404;
      throw error;
    }

    const log = await ShiftHandoverLog.create({
      manager_id: requesterIds[0],
      location_id: roster.location_id,
      shift_id: shift.id,
      note_text: String(note_text).trim(),
    });

    return log;
  }

  async getRecentHandovers({ location_ids, limit = 5 }) {
    if (!location_ids || location_ids.length === 0) {
      return [];
    }

    const logs = await ShiftHandoverLog.find({
      location_id: { $in: location_ids }
    })
    .sort({ created_at: -1 })
    .limit(Number(limit))
    .populate("manager", "name email")
    .populate("shift", "shift_name")
    .lean();

    return logs;
  }
}

module.exports = new ShiftHandoverService();
