const inventoryStockService = require("../services/inventoryStockService");

exports.createInventoryStock = async (req, res) => {
  try {
    const stock = await inventoryStockService.createInventoryStock(req.body);
    res.status(201).json({ success: true, message: "Inventory stock created successfully", data: stock });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating inventory stock" });
  }
};

exports.getAllInventoryStocks = async (req, res) => {
  try {
    const stocks = await inventoryStockService.getAllInventoryStocks(req.query);
    res.status(200).json({ success: true, count: stocks.length, data: stocks });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inventory stocks", error: error.message });
  }
};

exports.getInventoryStockById = async (req, res) => {
  try {
    const stock = await inventoryStockService.getInventoryStockById(req.params.id);
    res.status(200).json({ success: true, data: stock });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching inventory stock" });
  }
};

exports.updateInventoryStock = async (req, res) => {
  try {
    const stock = await inventoryStockService.updateInventoryStock(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Inventory stock updated successfully", data: stock });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating inventory stock" });
  }
};

exports.deleteInventoryStock = async (req, res) => {
  try {
    const result = await inventoryStockService.deleteInventoryStock(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting inventory stock" });
  }
};
