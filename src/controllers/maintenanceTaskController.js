const maintenanceTaskService = require("../services/maintenanceTaskService");

exports.createMaintenanceTask = async (req, res) => {
  try {
    const task = await maintenanceTaskService.createMaintenanceTask(req.body);
    res.status(201).json({ success: true, message: "Maintenance task created successfully", data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating maintenance task" });
  }
};

exports.getAllMaintenanceTasks = async (req, res) => {
  try {
    const tasks = await maintenanceTaskService.getAllMaintenanceTasks(req.query);
    res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching maintenance tasks" });
  }
};

exports.getMaintenanceTaskById = async (req, res) => {
  try {
    const task = await maintenanceTaskService.getMaintenanceTaskById(req.params.id);
    res.status(200).json({ success: true, data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching maintenance task" });
  }
};

exports.updateMaintenanceTask = async (req, res) => {
  try {
    const task = await maintenanceTaskService.updateMaintenanceTask(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Maintenance task updated successfully", data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating maintenance task" });
  }
};

exports.deleteMaintenanceTask = async (req, res) => {
  try {
    const result = await maintenanceTaskService.deleteMaintenanceTask(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting maintenance task" });
  }
};
