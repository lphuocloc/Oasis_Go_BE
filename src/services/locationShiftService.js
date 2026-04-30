const mongoose = require("mongoose");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const Location = require("../models/Location");
const User = require("../models/User");
const PodCluster = require("../models/PodCluster");

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
    const clusters = await PodCluster.find({ location_id: locationId }).select("id").lean();
    const clusterIds = clusters.map(c => c.id);

    // Get all active rosters for this location (managers) or its clusters (cleaners)
    const rosters = await StaffWorkRoster.find({
      $or: [
        { location_id: locationId },
        { cluster_id: { $in: clusterIds } }
      ],
      is_active: true
    }).lean();

    if (rosters.length === 0) {
      return { location, count: 0, data: [] };
    }

    const rosterStaffIds = [...new Set(rosters.map(r => String(r.staff_id)))];
    
    // Find checking status for today
    const now = filters.target_date ? new Date(`${String(filters.target_date).trim()}T12:00:00.000Z`) : new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const checkinLogs = await StaffAttendanceLog.find({
      staff_id: { $in: rosterStaffIds },
      action: "CHECKIN",
      created_at: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ created_at: -1 }).lean();

    const checkoutLogs = await StaffAttendanceLog.find({
      staff_id: { $in: rosterStaffIds },
      action: "CHECKOUT",
      created_at: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ created_at: -1 }).lean();

    const latestCheckinMap = new Map();
    checkinLogs.forEach(log => {
      if (!latestCheckinMap.has(String(log.staff_id))) {
        latestCheckinMap.set(String(log.staff_id), log);
      }
    });

    const latestCheckoutMap = new Map();
    checkoutLogs.forEach(log => {
      if (!latestCheckoutMap.has(String(log.staff_id))) {
        latestCheckoutMap.set(String(log.staff_id), log);
      }
    });

    const objectIdStaffIds = rosterStaffIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const userOrConditions = [];
    if (objectIdStaffIds.length > 0) {
      userOrConditions.push({ _id: { $in: objectIdStaffIds } });
    }
    userOrConditions.push({ id: { $in: rosterStaffIds } });

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

    let data = rosters.map(roster => {
      const staffId = String(roster.staff_id);
      const staff = userMap.get(staffId) || null;
      const shift = shiftMap.get(roster.shift_id) || null;
      
      const checkin = latestCheckinMap.get(staffId);
      const checkout = latestCheckoutMap.get(staffId);
      
      let status = "ASSIGNED"; // ROSTER equivalent
      if (checkin) {
        if (!checkout || checkout.created_at < checkin.created_at) {
          status = "CHECKED_IN";
        }
      }

      return {
        assignment_id: roster.id,
        start_date: null,
        end_date: null,
        status,
        checkin_at: checkin ? checkin.created_at : null,
        checkout_at: checkout ? checkout.created_at : null,
        staff,
        shift,
        location_shift: null,
      };
    });

    const includeAssigned = filters.include_assigned === true || String(filters.include_assigned).toLowerCase() === "true";
    
    if (!includeAssigned) {
      data = data.filter(d => d.status === "CHECKED_IN");
    }

    if (roleFilter) {
      data = data.filter(d => d.shift && String(d.shift.role).toUpperCase() === roleFilter);
    }

    return {
      location,
      count: data.length,
      data,
    };
  }

  async getAllLocationShifts(filters = {}) {
    const query = {};
    if (filters.location_ids) {
      query.location_id = { $in: filters.location_ids.split(',') };
    }
    if (filters.location_id) {
      query.location_id = filters.location_id;
    }
    if (filters.shift_id) {
      query.shift_id = filters.shift_id;
    }
    return LocationShift.find(query).sort({ created_at: -1 });
  }

  async deleteLocationShift(id) {
    if (!id) {
      const error = new Error("Location shift ID is required");
      error.statusCode = 400;
      throw error;
    }

    const shift = await LocationShift.findOne({ id });
    if (!shift) {
      const error = new Error("Location shift not found");
      error.statusCode = 404;
      throw error;
    }

    await LocationShift.deleteOne({ id });
    return { message: "Location shift deleted successfully" };
  }
}

module.exports = new LocationShiftService();
