const podQrCodeService = require("../services/podQrCodeService");

exports.createQrCode = async (req, res) => {
  try {
    const qr = await podQrCodeService.createQrCode(req.body);
    res.status(201).json({ success: true, message: "Pod QR code created successfully", data: qr });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating pod QR code" });
  }
};

exports.getAllQrCodes = async (req, res) => {
  try {
    const qrs = await podQrCodeService.getAllQrCodes(req.query);
    res.status(200).json({ success: true, count: qrs.length, data: qrs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching pod QR codes", error: error.message });
  }
};

exports.getQrCodeById = async (req, res) => {
  try {
    const qr = await podQrCodeService.getQrCodeById(req.params.id);
    res.status(200).json({ success: true, data: qr });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching pod QR code" });
  }
};

exports.updateQrCode = async (req, res) => {
  try {
    const qr = await podQrCodeService.updateQrCode(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Pod QR code updated successfully", data: qr });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating pod QR code" });
  }
};

exports.deleteQrCode = async (req, res) => {
  try {
    const result = await podQrCodeService.deleteQrCode(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting pod QR code" });
  }
};
