const cleaningTaskService = require("../services/cleaningTaskService");

exports.createCleaningTask = async (req, res) => {
  try {
    const task = await cleaningTaskService.createCleaningTask(req.body);
    res.status(201).json({ success: true, message: "Cleaning task created successfully", data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating cleaning task" });
  }
};

exports.getAllCleaningTasks = async (req, res) => {
  try {
    const tasks = await cleaningTaskService.getAllCleaningTasks(req.query);
    res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning tasks" });
  }
};

exports.getMyCleaningTasks = async (req, res) => {
  try {
    const tasks = await cleaningTaskService.getMyCleaningTasks(req.user, req.query);
    res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching my cleaning tasks" });
  }
};

exports.getCleaningTaskById = async (req, res) => {
  try {
    const task = await cleaningTaskService.getCleaningTaskById(req.params.id);
    res.status(200).json({ success: true, data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning task" });
  }
};

exports.updateCleaningTask = async (req, res) => {
  try {
    const task = await cleaningTaskService.updateCleaningTask(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Cleaning task updated successfully", data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating cleaning task" });
  }
};

exports.deleteCleaningTask = async (req, res) => {
  try {
    const result = await cleaningTaskService.deleteCleaningTask(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting cleaning task" });
  }
};
