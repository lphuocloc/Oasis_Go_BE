const mongoose = require("mongoose");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");

class StaffWorkRosterService {


  async findUserById(staffId) {
    const userQuery = { $or: [{ id: staffId }] };
    if (mongoose.Types.ObjectId.isValid(staffId)) {
      userQuery.$or.push({ _id: new mongoose.Types.ObjectId(staffId) });
    }

    return User.findOne(userQuery).select("_id id role name email");
  }

  async ensureRosterDependencies({ staff_id, shift_id, location_id, cluster_id }) {
    const StaffShift = require("../models/StaffShift");
    const Location = require("../models/Location");
    const PodCluster = require("../models/PodCluster");

    const [staff, shift] = await Promise.all([
      this.findUserById(staff_id),
      StaffShift.findOne({ id: shift_id }).lean(),
    ]);

    if (!staff) {
      const error = new Error("Staff not found");
      error.statusCode = 404;
      throw error;
    }

    const role = String(staff.role || "").toLowerCase();
    if (!["manager", "cleaner"].includes(role)) {
      const error = new Error("Selected user must have role manager or cleaner");
      error.statusCode = 400;
      throw error;
    }

    if (!shift) {
      const error = new Error("Shift not found");
      error.statusCode = 404;
      throw error;
    }

    if (role === "manager" && !location_id) {
        const error = new Error("Manager must be assigned to a location");
        error.statusCode = 400;
        throw error;
    }
    
    if (role === "cleaner" && !cluster_id) {
        const error = new Error("Cleaner must be assigned to a cluster");
        error.statusCode = 400;
        throw error;
    }

    if (location_id) {
        const location = await Location.findOne({ id: location_id }).lean();
        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }
    }

    if (cluster_id) {
        const cluster = await PodCluster.findOne({ id: cluster_id }).lean();
        if (!cluster) {
            const error = new Error("Cluster not found");
            error.statusCode = 404;
            throw error;
        }
    }

    return { staff, shift };
  }

  async createRoster(data) {
    const { staff_id, shift_id, location_id, cluster_id } = data;

    if (!staff_id || !shift_id) {
      const error = new Error("staff_id and shift_id are required");
      error.statusCode = 400;
      throw error;
    }

    await this.ensureRosterDependencies({ staff_id, shift_id, location_id, cluster_id });

    // Ensure staff doesn't already have an active roster for this shift
    const existing = await StaffWorkRoster.findOne({
      staff_id,
      shift_id,
      location_id: location_id || null,
      cluster_id: cluster_id || null
    });

    if (existing) {
      const duplicateError = new Error("Roster already exists for this staff at this location/cluster for this shift");
      duplicateError.statusCode = 409;
      throw duplicateError;
    }

    try {
      const is_active = data.is_active !== undefined ? Boolean(data.is_active) : true;
      const roster = await StaffWorkRoster.create({
        staff_id,
        shift_id,
        location_id: location_id || null,
        cluster_id: cluster_id || null,
        is_active,
      });
      return roster;
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("Roster already exists for this staff");
        duplicateError.statusCode = 409;
        throw duplicateError;
      }
      throw error;
    }
  }

  async getAllRosters(filters = {}, actor = null) {
    const query = {};
    const userRole = String(actor?.role || "").toLowerCase();
    const userId = actor?.id || actor?._id;

    // Authorization logic:
    // - admin: view all rosters
    // - manager: view their own roster + all cleaner rosters
    // - cleaner: view only their own roster
    if (userRole === "cleaner" && userId) {
      query.staff_id = userId;
    } else if (userRole === "manager" && userId) {
      // Manager: their own roster OR any cleaner's roster
      const cleaners = await User.find({ role: "cleaner" }).select("id _id").lean();
      const cleanerIds = cleaners.map(c => c.id || String(c._id));
      
      query.$or = [
        { staff_id: userId },
        { staff_id: { $in: cleanerIds } }
      ];
    }
    // admin/else: no staff_id filter, can see all after applying other filters

    // Apply other filters from request
    if (filters.staff_id && userRole === "admin") {
      query.staff_id = filters.staff_id;
    }

    if (filters.shift_id) {
      query.shift_id = filters.shift_id;
    }
    if (filters.location_id) {
      query.location_id = filters.location_id;
    }
    if (filters.cluster_id) {
      query.cluster_id = filters.cluster_id;
    }

    if (filters.is_active !== undefined) {
      query.is_active = String(filters.is_active).toLowerCase() === "true";
    }

    return StaffWorkRoster.find(query).sort({ staff_id: 1, created_at: -1 });
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
    const nextShiftId = data.shift_id !== undefined ? data.shift_id : roster.shift_id;
    const nextLocationId = data.location_id !== undefined ? data.location_id : roster.location_id;
    const nextClusterId = data.cluster_id !== undefined ? data.cluster_id : roster.cluster_id;

    if (data.staff_id !== undefined || data.shift_id !== undefined || data.location_id !== undefined || data.cluster_id !== undefined) {
      await this.ensureRosterDependencies({
        staff_id: nextStaffId,
        shift_id: nextShiftId,
        location_id: nextLocationId,
        cluster_id: nextClusterId
      });
      roster.staff_id = nextStaffId;
      roster.shift_id = nextShiftId;
      roster.location_id = nextLocationId || null;
      roster.cluster_id = nextClusterId || null;
    }

    if (data.is_active !== undefined) {
      roster.is_active = Boolean(data.is_active);
    }

    try {
      await roster.save();
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("Roster already exists for this staff");
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
