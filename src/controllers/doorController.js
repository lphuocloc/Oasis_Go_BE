const doorService = require("../services/doorService");

exports.createDoor = async (req, res) => {
  try {
    const door = await doorService.createDoor(req.body);
    res.status(201).json({ success: true, message: "Door created successfully", data: door });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating door" });
  }
};

exports.generateDoorsByPodCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;
    const result = await doorService.generateDoorsByPodCluster(clusterId);
    res.status(201).json({
      success: true,
      message: "Doors generated successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error generating doors by cluster",
    });
  }
};

exports.getAllDoors = async (req, res) => {
  try {
    const doors = await doorService.getAllDoors(req.query);
    res.status(200).json({ success: true, count: doors.length, data: doors });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching doors", error: error.message });
  }
};

exports.getDoorById = async (req, res) => {
  try {
    const door = await doorService.getDoorById(req.params.id);
    res.status(200).json({ success: true, data: door });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching door" });
  }
};

exports.updateDoor = async (req, res) => {
  try {
    const door = await doorService.updateDoor(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Door updated successfully", data: door });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating door" });
  }
};

exports.deleteDoor = async (req, res) => {
  try {
    const result = await doorService.deleteDoor(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting door" });
  }
};
