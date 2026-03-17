const warehouseService = require("../services/warehouseService");

exports.createWarehouse = async (req, res) => {
  try {
    const warehouse = await warehouseService.createWarehouse(req.body);
    res.status(201).json({ success: true, message: "Warehouse created successfully", data: warehouse });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating warehouse" });
  }
};

exports.getAllWarehouses = async (req, res) => {
  try {
    const warehouses = await warehouseService.getAllWarehouses(req.query);
    res.status(200).json({ success: true, count: warehouses.length, data: warehouses });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching warehouses", error: error.message });
  }
};

exports.getWarehouseById = async (req, res) => {
  try {
    const warehouse = await warehouseService.getWarehouseById(req.params.id);
    res.status(200).json({ success: true, data: warehouse });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching warehouse" });
  }
};

exports.updateWarehouse = async (req, res) => {
  try {
    const warehouse = await warehouseService.updateWarehouse(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Warehouse updated successfully", data: warehouse });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating warehouse" });
  }
};

exports.deleteWarehouse = async (req, res) => {
  try {
    const result = await warehouseService.deleteWarehouse(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting warehouse" });
  }
};
