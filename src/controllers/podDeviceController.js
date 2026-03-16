const podDeviceService = require("../services/podDeviceService");

exports.createDevice = async (req, res) => {
  try {
    const device = await podDeviceService.createDevice(req.body);
    res.status(201).json({ success: true, message: "Pod device created successfully", data: device });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating pod device" });
  }
};

exports.getAllDevices = async (req, res) => {
  try {
    const devices = await podDeviceService.getAllDevices(req.query);
    res.status(200).json({ success: true, count: devices.length, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching pod devices", error: error.message });
  }
};

exports.getDeviceById = async (req, res) => {
  try {
    const device = await podDeviceService.getDeviceById(req.params.id);
    res.status(200).json({ success: true, data: device });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching pod device" });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const device = await podDeviceService.updateDevice(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Pod device updated successfully", data: device });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating pod device" });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const result = await podDeviceService.deleteDevice(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting pod device" });
  }
};
