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

    let resolvedLocationId = location_id;
    if (cluster_id) {
        const cluster = await PodCluster.findOne({ id: cluster_id }).lean();
        if (!cluster) {
            const error = new Error("Cluster not found");
            error.statusCode = 404;
            throw error;
        }
        // Auto-resolve location_id from cluster if not provided
        if (!resolvedLocationId) {
            resolvedLocationId = cluster.location_id;
        }
    }

    if (resolvedLocationId) {
        const location = await Location.findOne({ id: resolvedLocationId }).lean();
        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }
    }

    return { staff, shift, resolvedLocationId };
  }

  async createRoster(data) {
    const { staff_id, shift_id, location_id, cluster_id, is_temporary, work_date } = data;

    if (!staff_id || !shift_id) {
      const error = new Error("staff_id and shift_id are required");
      error.statusCode = 400;
      throw error;
    }

    const { staff, shift, resolvedLocationId } = await this.ensureRosterDependencies({ staff_id, shift_id, location_id, cluster_id });

    // Ensure staff doesn't already have an active roster for this shift
    // For temporary rosters, we don't strictly prevent duplicates if one is permanent and one is temporary,
    // but the unique index requires us to be careful. However, since they have same staff, shift, loc, cluster,
    // the unique index will block it. If the manager is temporarily assigning them to a DIFFERENT cluster,
    // the unique index won't trigger. 
    const existing = await StaffWorkRoster.findOne({
      staff_id,
      shift_id,
      location_id: resolvedLocationId || null,
      cluster_id: cluster_id || null
    });

    if (existing) {
      const duplicateError = new Error("Roster already exists for this staff at this location/cluster for this shift");
      duplicateError.statusCode = 409;
      throw duplicateError;
    }

    try {
      const is_active = data.is_active !== undefined ? Boolean(data.is_active) : true;
      const isTemporary = Boolean(is_temporary);
      const workDate = work_date ? new Date(work_date) : null;
      
      const roster = await StaffWorkRoster.create({
        staff_id,
        shift_id,
        location_id: resolvedLocationId || null,
        cluster_id: cluster_id || null,
        is_active,
        is_temporary: isTemporary,
        work_date: workDate,
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

  async getAllRosters(filters = {}, actor = null, scopeLocationIds = []) {
    const query = {};
    const userRole = String(actor?.role || "").toLowerCase();
    const userId = actor?.id || actor?._id;

    // Authorization logic:
    // - admin: view all rosters
    // - manager: view their own roster + all cleaner rosters + any roster in their location scope
    // - cleaner: view only their own roster
    if (userRole === "cleaner" && userId) {
      query.staff_id = userId;
    } else if (userRole === "manager" && userId) {
      // Manager: their own roster OR any cleaner's roster OR any roster in their locations
      const cleaners = await User.find({ role: "cleaner" }).select("id _id").lean();
      const cleanerIds = cleaners.map(c => c.id || String(c._id));
      
      const scopeIds = scopeLocationIds || [];
      
      if (scopeIds.length > 0) {
        query.$or = [
          { staff_id: userId },
          { staff_id: { $in: cleanerIds } },
          { location_id: { $in: scopeIds } }
        ];
      } else {
        query.$or = [
          { staff_id: userId },
          { staff_id: { $in: cleanerIds } }
        ];
      }
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

  async autoDeactivateExpiredTemporaryRosters() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await StaffWorkRoster.updateMany(
        {
          is_temporary: true,
          is_active: true,
          work_date: { $lt: today, $ne: null }
        },
        {
          $set: { is_active: false }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`[StaffWorkRosterService] Auto-deactivated ${result.modifiedCount} expired temporary rosters.`);
      }
    } catch (error) {
      console.error("[StaffWorkRosterService] Error auto-deactivating temporary rosters:", error);
    }
  }
}

module.exports = new StaffWorkRosterService();
