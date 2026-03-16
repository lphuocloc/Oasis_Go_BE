const itemService = require("../services/itemService");

exports.createItem = async (req, res) => {
  try {
    const item = await itemService.createItem(req.body);
    res.status(201).json({ success: true, message: "Item created successfully", data: item });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating item" });
  }
};

exports.getAllItems = async (req, res) => {
  try {
    const items = await itemService.getAllItems(req.query);
    res.status(200).json({ success: true, count: items.length, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching items", error: error.message });
  }
};

exports.getItemById = async (req, res) => {
  try {
    const item = await itemService.getItemById(req.params.id);
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching item" });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const item = await itemService.updateItem(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Item updated successfully", data: item });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating item" });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const result = await itemService.deleteItem(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting item" });
  }
};
