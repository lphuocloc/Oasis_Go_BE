const locationWarehouseService = require("../services/locationWarehouseService");

exports.createLocationWarehouse = async (req, res) => {
  try {
    const mapping = await locationWarehouseService.createLocationWarehouse(req.body);
    res.status(201).json({ success: true, message: "Location-warehouse mapping created successfully", data: mapping });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating location-warehouse mapping" });
  }
};

exports.getAllLocationWarehouses = async (req, res) => {
  try {
    const mappings = await locationWarehouseService.getAllLocationWarehouses(req.query);
    res.status(200).json({ success: true, count: mappings.length, data: mappings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching location-warehouse mappings", error: error.message });
  }
};

exports.getLocationWarehouseById = async (req, res) => {
  try {
    const mapping = await locationWarehouseService.getLocationWarehouseById(req.params.id);
    res.status(200).json({ success: true, data: mapping });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching location-warehouse mapping" });
  }
};

exports.getEffectiveLocationWarehouses = async (req, res) => {
  try {
    const data = await locationWarehouseService.getEffectiveLocationWarehouses(req.params.locationId);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error resolving effective location-warehouse mappings" });
  }
};

exports.getEffectiveLocationWarehousesDebug = async (req, res) => {
  try {
    const result = await locationWarehouseService.getEffectiveLocationWarehousesDebug(req.params.locationId);
    res.status(200).json({
      success: true,
      count: result.data.length,
      data: result.data,
      trace: result.trace,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error resolving effective location-warehouse mappings" });
  }
};

exports.updateLocationWarehouse = async (req, res) => {
  try {
    const mapping = await locationWarehouseService.updateLocationWarehouse(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Location-warehouse mapping updated successfully", data: mapping });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating location-warehouse mapping" });
  }
};

exports.deleteLocationWarehouse = async (req, res) => {
  try {
    const result = await locationWarehouseService.deleteLocationWarehouse(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting location-warehouse mapping" });
  }
};
