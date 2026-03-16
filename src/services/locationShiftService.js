const mongoose = require("mongoose");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const Location = require("../models/Location");
const User = require("../models/User");

class LocationShiftService {
  async createLocationShift(data) {
    const { location_id, shift_id } = data;

    if (!location_id || !shift_id) {
      const error = new Error("location_id and shift_id are required");
      error.statusCode = 400;
      throw error;
    }

    const [location, shift] = await Promise.all([
      Location.findOne({ id: location_id }).select("id name type").lean(),
      StaffShift.findOne({ id: shift_id }).select("id role shift_name is_active").lean(),
    ]);

    if (!location) {
      const error = new Error("Location not found");
      error.statusCode = 404;
      throw error;
    }

    if (!shift) {
      const error = new Error("Staff shift not found");
      error.statusCode = 404;
      throw error;
    }

    const existing = await LocationShift.findOne({ location_id, shift_id }).lean();
    if (existing) {
      const error = new Error("Location shift already exists for this location and shift");
      error.statusCode = 409;
      throw error;
    }

    return LocationShift.create({ location_id, shift_id });
  }

  async getWorkingStaffByLocation(locationId, filters = {}) {
    if (!locationId) {
      const error = new Error("locationId is required");
      error.statusCode = 400;
      throw error;
    }

    const location = await Location.findOne({ id: locationId }).select("id name type").lean();
    if (!location) {
      const error = new Error("Location not found");
      error.statusCode = 404;
      throw error;
    }

    const roleFilter = filters.role ? String(filters.role).toUpperCase() : null;

    const locationShifts = await LocationShift.find({ location_id: locationId }).lean();
    if (locationShifts.length === 0) {
      return { location, count: 0, data: [] };
    }

    const shiftIds = [...new Set(locationShifts.map((x) => x.shift_id))];
    const shiftQuery = { id: { $in: shiftIds } };
    if (roleFilter) {
      shiftQuery.role = roleFilter;
    }

    const shifts = await StaffShift.find(shiftQuery).lean();
    if (shifts.length === 0) {
      return { location, count: 0, data: [] };
    }

    const shiftMap = new Map(shifts.map((x) => [x.id, x]));
    const filteredLocationShifts = locationShifts.filter((x) => shiftMap.has(x.shift_id));
    if (filteredLocationShifts.length === 0) {
      return { location, count: 0, data: [] };
    }

    const locationShiftMap = new Map(filteredLocationShifts.map((x) => [x.id, x]));
    const locationShiftIds = filteredLocationShifts.map((x) => x.id);

    const includeAssigned =
      filters.include_assigned === true ||
      String(filters.include_assigned).toLowerCase() === "true";

    const assignmentQuery = {
      location_shift_id: { $in: locationShiftIds },
    };

    if (includeAssigned) {
      assignmentQuery.$or = [
        {
          status: "CHECKED_IN",
          checkin_at: { $ne: null },
          checkout_at: null,
        },
        {
          status: "ASSIGNED",
        },
      ];
    } else {
      assignmentQuery.status = "CHECKED_IN";
      assignmentQuery.checkin_at = { $ne: null };
      assignmentQuery.checkout_at = null;
    }

    if (filters.work_date) {
      const date = new Date(filters.work_date);
      if (Number.isNaN(date.getTime())) {
        const error = new Error("work_date must be a valid date (YYYY-MM-DD)");
        error.statusCode = 400;
        throw error;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      assignmentQuery.work_date = { $gte: startOfDay, $lte: endOfDay };
    }

    const assignments = await StaffShiftAssignment.find(assignmentQuery)
      .sort({ checkin_at: -1, created_at: -1 })
      .lean();

    if (assignments.length === 0) {
      return { location, count: 0, data: [] };
    }

    const staffIds = [...new Set(assignments.map((x) => x.staff_id).filter(Boolean))];
    const objectIdStaffIds = staffIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const userOrConditions = [];
    if (objectIdStaffIds.length > 0) {
      userOrConditions.push({ _id: { $in: objectIdStaffIds } });
    }
    userOrConditions.push({ id: { $in: staffIds } });

    const users = await User.find({ $or: userOrConditions })
      .select("_id id name email phone role")
      .lean();

    const userMap = new Map();
    users.forEach((u) => {
      userMap.set(String(u._id), u);
      if (u.id) {
        userMap.set(String(u.id), u);
      }
    });

    const data = assignments.map((assignment) => {
      const locationShift = locationShiftMap.get(assignment.location_shift_id) || null;
      const shift = locationShift ? shiftMap.get(locationShift.shift_id) || null : null;
      const staff = userMap.get(String(assignment.staff_id)) || null;

      return {
        assignment_id: assignment.id,
        work_date: assignment.work_date,
        status: assignment.status,
        checkin_at: assignment.checkin_at,
        checkout_at: assignment.checkout_at,
        staff,
        shift,
        location_shift: locationShift,
      };
    });

    return {
      location,
      count: data.length,
      data,
    };
  }
}

module.exports = new LocationShiftService();
