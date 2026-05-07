const staffWorkRosterService = require("../services/staffWorkRosterService");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");

const createRoster = async (req, res) => {
  try {
    const staff = await User.findOne({ $or: [{ id: req.body.staff_id }, { _id: req.body.staff_id }] }).select("role").lean();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    if (staff.role === "cleaner") {
      if (req.user.role !== "manager") {
        return res.status(403).json({ success: false, message: "Chỉ Manager mới có quyền gán Roster cho Cleaner" });
      }

      // Scope check: manager can only assign to clusters/locations they manage
      if (req.managerScope) {
        if (req.body.cluster_id && !req.managerScope.clusterIds.includes(String(req.body.cluster_id))) {
          return res.status(403).json({ success: false, message: "Cluster này không thuộc khu vực bạn quản lý" });
        }
        // Shift scope: manager can ONLY assign cleaner to a shift they themselves are assigned to
        if (req.body.shift_id && !req.managerScope.shiftIds.includes(String(req.body.shift_id))) {
          return res.status(403).json({ success: false, message: "Bạn chỉ được phép gán cleaner vào ca trực của mình" });
        }
      }
    } else if (staff.role === "manager") {
      if (req.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Chỉ Admin mới có quyền gán Roster cho Manager" });
      }
    } else {
      return res.status(403).json({ success: false, message: "Không thể gán Roster cho vai trò này" });
    }

    const result = await staffWorkRosterService.createRoster(req.body);
    res.status(201).json({
      success: true,
      message: "Staff roster created successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create staff roster",
    });
  }
};

const getAllRosters = async (req, res) => {
  try {
    let query = { ...req.query };

    // Auto-filter by manager scope if requested by manager, to prevent viewing other locations' rosters
    // Auto-filter by manager scope is handled inside the service.
    // If the manager passes a specific shift_id, we can optionally validate it here.
    if (req.user && req.user.role === "manager") {
      if (query.shift_id && !req.managerScope.shiftIds.includes(String(query.shift_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this shift" });
      }
    }

    const rosters = await staffWorkRosterService.getAllRosters(
      query,
      req.user,
      req.managerScope ? req.managerScope.locationIds : []
    );
    res.status(200).json({
      success: true,
      count: rosters.length,
      data: rosters,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve staff rosters",
    });
  }
};

const getRosterById = async (req, res) => {
  try {
    const roster = await staffWorkRosterService.getRosterById(req.params.id);

    if (req.user && req.user.role === "cleaner") {
      const cleanerId = req.user.id ? String(req.user.id) : "";
      if (!cleanerId || String(roster.staff_id) !== cleanerId) {
        return res.status(403).json({ success: false, message: "You can only view your own roster" });
      }
    }

    if (req.user && req.user.role === "manager") {
      if (roster.location_id && !req.managerScope.locationIds.includes(String(roster.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location" });
      }
      if (roster.cluster_id && !req.managerScope.clusterIds.includes(String(roster.cluster_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this cluster" });
      }
      if (roster.shift_id && !req.managerScope.shiftIds.includes(String(roster.shift_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this shift" });
      }
    }

    res.status(200).json({
      success: true,
      data: roster,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve staff roster",
    });
  }
};

const updateRoster = async (req, res) => {
  try {
    if (req.user && req.user.role === "manager") {
      const existingRoster = await staffWorkRosterService.getRosterById(req.params.id);

      const checkLocId = req.body.location_id || existingRoster.location_id;
      if (checkLocId && !req.managerScope.locationIds.includes(String(checkLocId))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location" });
      }

      const checkClusterId = req.body.cluster_id || existingRoster.cluster_id;
      if (checkClusterId && !req.managerScope.clusterIds.includes(String(checkClusterId))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this cluster" });
      }

      const checkShiftId = req.body.shift_id || existingRoster.shift_id;
      if (checkShiftId && !req.managerScope.shiftIds.includes(String(checkShiftId))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this shift" });
      }

      if (req.body.staff_id) {
        const staff = await User.findOne({ $or: [{ id: req.body.staff_id }, { _id: req.body.staff_id }] }).select("role").lean();
        if (!staff || staff.role !== "cleaner") {
          return res.status(403).json({ success: false, message: "Managers can only assign rosters to cleaners" });
        }
      }
    }

    const roster = await staffWorkRosterService.updateRoster(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Staff roster updated successfully",
      data: roster,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update staff roster",
    });
  }
};

const deleteRoster = async (req, res) => {
  try {
    if (req.user && req.user.role === "manager") {
      const existingRoster = await staffWorkRosterService.getRosterById(req.params.id);
      if (existingRoster.location_id && !req.managerScope.locationIds.includes(String(existingRoster.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location" });
      }
      if (existingRoster.cluster_id && !req.managerScope.clusterIds.includes(String(existingRoster.cluster_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this cluster" });
      }
      if (existingRoster.shift_id && !req.managerScope.shiftIds.includes(String(existingRoster.shift_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this shift" });
      }
    }

    await staffWorkRosterService.deleteRoster(req.params.id);
    res.status(200).json({
      success: true,
      message: "Staff roster deleted successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to delete staff roster",
    });
  }
};

const getMyRosters = async (req, res) => {
  try {
    const userId = req.user.id || String(req.user._id);
    const rosters = await staffWorkRosterService.getMyRostersWithFullInfo(userId);
    res.status(200).json({
      success: true,
      count: rosters.length,
      data: rosters,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve your rosters",
    });
  }
};

module.exports = {
  createRoster,
  getAllRosters,
  getRosterById,
  updateRoster,
  deleteRoster,
  getMyRosters,
};
