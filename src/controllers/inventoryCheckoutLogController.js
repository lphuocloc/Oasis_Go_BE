const inventoryCheckoutLogService = require("../services/inventoryCheckoutLogService");

exports.createInventoryCheckoutLog = async (req, res) => {
  try {
    const log = await inventoryCheckoutLogService.createInventoryCheckoutLog(req.body, req.user);
    res.status(201).json({ success: true, message: "Inventory checkout log created successfully", data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating inventory checkout log" });
  }
};

exports.getAllInventoryCheckoutLogs = async (req, res) => {
  try {
    const logs = await inventoryCheckoutLogService.getAllInventoryCheckoutLogs(req.query);
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inventory checkout logs", error: error.message });
  }
};

exports.getInventoryCheckoutLogById = async (req, res) => {
  try {
    const log = await inventoryCheckoutLogService.getInventoryCheckoutLogById(req.params.id);
    res.status(200).json({ success: true, data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching inventory checkout log" });
  }
};

exports.updateInventoryCheckoutLog = async (req, res) => {
  try {
    const log = await inventoryCheckoutLogService.updateInventoryCheckoutLog(req.params.id, req.body, req.user);
    res.status(200).json({ success: true, message: "Inventory checkout log updated successfully", data: log });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating inventory checkout log" });
  }
};

exports.deleteInventoryCheckoutLog = async (req, res) => {
  try {
    const result = await inventoryCheckoutLogService.deleteInventoryCheckoutLog(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting inventory checkout log" });
  }
};
