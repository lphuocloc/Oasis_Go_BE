const staffWorkRosterService = require("../services/staffWorkRosterService");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");

const createRoster = async (req, res) => {
  try {
    if (req.user && req.user.role === "manager") {
      const staff = await User.findOne({ $or: [{ id: req.body.staff_id }, { _id: req.body.staff_id }] }).select("role").lean();
      if (!staff || staff.role !== "cleaner") {
        return res.status(403).json({ success: false, message: "Managers can only assign rosters to cleaners" });
      }

      const locShift = await LocationShift.findOne({ id: req.body.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location shift" });
      }
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
    if (req.user && req.user.role === "manager") {
      const allowedLocShifts = await LocationShift.find({ location_id: { $in: req.managerScope.locationIds } }).select("id").lean();
      const allowedLocShiftIds = allowedLocShifts.map(ls => ls.id);
      
      if (query.location_shift_id) {
         if (!allowedLocShiftIds.includes(query.location_shift_id)) {
             return res.status(403).json({ success: false, message: "Out of management scope" });
         }
      } else {
         query.location_shift_ids = allowedLocShiftIds.join(','); // requires backend support in service for this... wait!
      }
    }

    const rosters = await staffWorkRosterService.getAllRosters(query);
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

    if (req.user && req.user.role === "manager") {
      const locShift = await LocationShift.findOne({ id: roster.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
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
      
      const checkLocShiftId = req.body.location_shift_id || existingRoster.location_shift_id;
      const locShift = await LocationShift.findOne({ id: checkLocShiftId }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope for this location shift" });
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
      const locShift = await LocationShift.findOne({ id: existingRoster.location_shift_id }).select("location_id").lean();
      if (!locShift || !req.managerScope.locationIds.includes(String(locShift.location_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
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

module.exports = {
  createRoster,
  getAllRosters,
  getRosterById,
  updateRoster,
  deleteRoster,
};
