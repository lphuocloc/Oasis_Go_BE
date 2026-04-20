const inventoryActivityLogService = require("../services/inventoryActivityLogService");

exports.createInventoryActivityLog = async (req, res) => {
  try {
    const log = await inventoryActivityLogService.createInventoryActivityLog(req.body, req.user);
    res.status(201).json({ success: true, message: "inventory activity log created successfully", data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating inventory activity log" });
  }
};

exports.createInventoryActivityLogsBulk = async (req, res) => {
  try {
    const result = await inventoryActivityLogService.createInventoryActivityLogsBulk(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "Inventory Activity Logs created successfully",
      count: result.count,
      data: result.logs,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating Inventory Activity Logs",
    });
  }
};

exports.getShiftInventoryEstimation = async (req, res) => {
  try {
    const estimation = await inventoryActivityLogService.estimateByCleanerDay(
      req.params.cleaner_id,
      req.user,
      req.query
    );

    res.status(200).json({
      success: true,
      data: estimation,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error estimating daily inventory" });
  }
};

exports.getCleanerDailyActivityLogs = async (req, res) => {
  try {
    const result = await inventoryActivityLogService.getCleanerDailyActivityLogs(
      req.params.cleaner_id,
      req.user,
      req.query
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching daily checkout logs" });
  }
};

exports.getDailyTakenItemsSummary = async (req, res) => {
  try {
    const result = await inventoryActivityLogService.getDailyTakenItemsSummary(req.user, req.query);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching daily taken-item summary" });
  }
};

exports.getAllInventoryActivityLogs = async (req, res) => {
  try {
    const logs = await inventoryActivityLogService.getAllInventoryActivityLogs(req.query);
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching Inventory Activity Logs", error: error.message });
  }
};

exports.getInventoryActivityLogById = async (req, res) => {
  try {
    const log = await inventoryActivityLogService.getInventoryActivityLogById(req.params.id);
    res.status(200).json({ success: true, data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching inventory activity log" });
  }
};

exports.updateInventoryActivityLog = async (req, res) => {
  try {
    const log = await inventoryActivityLogService.updateInventoryActivityLog(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, message: "inventory activity log updated successfully", data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating inventory activity log" });
  }
};

exports.deleteInventoryActivityLog = async (req, res) => {
  try {
    const result = await inventoryActivityLogService.deleteInventoryActivityLog(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting inventory activity log" });
  }
};
