const staffWorkRosterService = require("../services/staffWorkRosterService");

const createRoster = async (req, res) => {
  try {
    const roster = await staffWorkRosterService.createRoster(req.body);
    res.status(201).json({
      success: true,
      message: "Staff roster created successfully",
      data: roster,
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
    const rosters = await staffWorkRosterService.getAllRosters(req.query);
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
