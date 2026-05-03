const shiftHandoverService = require("../services/shiftHandoverService");

const createHandover = async (req, res) => {
  try {
    const result = await shiftHandoverService.createHandover({
      user: req.user,
      note_text: req.body.note_text,
    });

    res.status(201).json({
      success: true,
      message: "Handover note created successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create handover note",
    });
  }
};

const getRecentHandovers = async (req, res) => {
  try {
    let locationIds = [];
    if (req.user && req.user.role === "manager" && req.managerScope && req.managerScope.locationIds) {
      locationIds = req.managerScope.locationIds;
    } else if (req.query.location_ids) {
      locationIds = req.query.location_ids.split(",");
    }

    const result = await shiftHandoverService.getRecentHandovers({
      location_ids: locationIds,
      limit: req.query.limit || 5,
    });

    res.status(200).json({
      success: true,
      message: "Recent handovers retrieved successfully",
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve recent handovers",
    });
  }
};

module.exports = {
  createHandover,
  getRecentHandovers,
};
