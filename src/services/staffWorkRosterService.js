const mongoose = require("mongoose");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");

class StaffWorkRosterService {
  normalizeDayOfWeek(dayOfWeek) {
    const parsed = Number(dayOfWeek);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
      const error = new Error("day_of_week must be an integer from 0 to 6");
      error.statusCode = 400;
      throw error;
    }

    return parsed;
  }

  async findUserById(staffId) {
    const userQuery = { $or: [{ id: staffId }] };
    if (mongoose.Types.ObjectId.isValid(staffId)) {
      userQuery.$or.push({ _id: new mongoose.Types.ObjectId(staffId) });
    }

    return User.findOne(userQuery).select("_id id role name email");
  }

  async ensureRosterDependencies({ staff_id, location_shift_id }) {
    const [staff, locationShift] = await Promise.all([
      this.findUserById(staff_id),
      LocationShift.findOne({ id: location_shift_id }).select("id location_id shift_id").lean(),
    ]);

    if (!staff) {
      const error = new Error("Staff not found");
      error.statusCode = 404;
      throw error;
    }

    if (!["manager", "cleaner"].includes(String(staff.role || "").toLowerCase())) {
      const error = new Error("Selected user must have role manager or cleaner");
      error.statusCode = 400;
      throw error;
    }

    if (!locationShift) {
      const error = new Error("Location shift not found");
      error.statusCode = 404;
      throw error;
    }

    return { staff, locationShift };
  }

  async createRoster(data) {
    const { staff_id, location_shift_id } = data;
    if (!staff_id || !location_shift_id || data.day_of_week === undefined) {
      const error = new Error(
        "staff_id, location_shift_id and day_of_week are required"
      );
      error.statusCode = 400;
      throw error;
    }

    const day_of_week = this.normalizeDayOfWeek(data.day_of_week);

    await this.ensureRosterDependencies({ staff_id, location_shift_id });

    try {
      return await StaffWorkRoster.create({
        staff_id,
        location_shift_id,
        day_of_week,
        is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("Roster already exists for this staff, location shift and day_of_week");
        duplicateError.statusCode = 409;
        throw duplicateError;
      }
      throw error;
    }
  }

  async getAllRosters(filters = {}) {
    const query = {};

    if (filters.staff_id) {
      query.staff_id = filters.staff_id;
    }

    if (filters.location_shift_id) {
      query.location_shift_id = filters.location_shift_id;
    }
    if (filters.location_shift_ids) {
      query.location_shift_id = { $in: filters.location_shift_ids.split(",") };
    }

    if (filters.day_of_week !== undefined) {
      query.day_of_week = this.normalizeDayOfWeek(filters.day_of_week);
    }

    if (filters.is_active !== undefined) {
      query.is_active = String(filters.is_active).toLowerCase() === "true";
    }

    return StaffWorkRoster.find(query).sort({ staff_id: 1, day_of_week: 1, created_at: -1 });
  }

  async getRosterById(id) {
    const roster = await StaffWorkRoster.findOne({ id });
    if (!roster) {
      const error = new Error("Roster not found");
      error.statusCode = 404;
      throw error;
    }

    return roster;
  }

  async updateRoster(id, data) {
    const roster = await this.getRosterById(id);

    const nextStaffId = data.staff_id !== undefined ? data.staff_id : roster.staff_id;
    const nextLocationShiftId =
      data.location_shift_id !== undefined ? data.location_shift_id : roster.location_shift_id;

    if (data.staff_id !== undefined || data.location_shift_id !== undefined) {
      await this.ensureRosterDependencies({
        staff_id: nextStaffId,
        location_shift_id: nextLocationShiftId,
      });
      roster.staff_id = nextStaffId;
      roster.location_shift_id = nextLocationShiftId;
    }

    if (data.day_of_week !== undefined) {
      roster.day_of_week = this.normalizeDayOfWeek(data.day_of_week);
    }

    if (data.is_active !== undefined) {
      roster.is_active = Boolean(data.is_active);
    }

    try {
      await roster.save();
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("Roster already exists for this staff, location shift and day_of_week");
        duplicateError.statusCode = 409;
        throw duplicateError;
      }
      throw error;
    }

    return roster;
  }

  async deleteRoster(id) {
    const roster = await this.getRosterById(id);
    await StaffWorkRoster.deleteOne({ id });
    return roster;
  }
}

module.exports = new StaffWorkRosterService();
