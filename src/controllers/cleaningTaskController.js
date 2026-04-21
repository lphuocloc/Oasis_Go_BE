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

exports.getMyCleanerKeyByTaskId = async (req, res) => {
  try {
    const data = await cleaningTaskService.getMyCleanerKeyByTaskId(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: "Cleaner key retrieved successfully",
      data,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching cleaner key by task",
      error_code: error.errorCode || "CLEANER_KEY_RETRIEVAL_FAILED",
    });
  }
};

exports.getCleaningTaskById = async (req, res) => {
  try {
    const task = await cleaningTaskService.getCleaningTaskById(req.params.id);

    if (req.user && req.user.role === "manager" && req.managerScope) {
      if (!req.managerScope.podIds.includes(String(task.pod_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
      }
    }

    res.status(200).json({ success: true, data: task });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning task" });
  }
};

exports.updateCleaningTask = async (req, res) => {
  try {
    if (req.user && req.user.role === "manager" && req.managerScope) {
      const oldTask = await cleaningTaskService.getCleaningTaskById(req.params.id);
      if (!req.managerScope.podIds.includes(String(oldTask.pod_id))) {
        return res.status(403).json({ success: false, message: "Out of management scope" });
      }
      if (req.body.pod_id && !req.managerScope.podIds.includes(String(req.body.pod_id))) {
        return res.status(403).json({ success: false, message: "New pod is out of management scope" });
      }
    }

    const task = await cleaningTaskService.updateCleaningTask(req.params.id, req.body, req.user);
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

exports.backfillCleaningTasks = async (req, res) => {
  try {
    const result = await cleaningTaskService.backfillMissingCleaningTasks(req.body || {});
    res.status(200).json({
      success: true,
      message: "Cleaning task backfill completed",
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error running cleaning task backfill",
    });
  }
};

