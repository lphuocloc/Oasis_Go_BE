const podQrCodeService = require("../services/podQrCodeService");
const { emitQrCodeEvent } = require("../socket/socketServer");

exports.createQrCode = async (req, res) => {
  try {
    const qr = await podQrCodeService.createQrCode(req.body);
    emitQrCodeEvent(qr, "created");
    res.status(201).json({ success: true, message: "Pod QR code created successfully", data: qr });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating pod QR code" });
  }
};

exports.generateQrCodesByPodCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;
    const result = await podQrCodeService.generateQrCodesByPodCluster(clusterId, req.body || {});

    for (const qr of result.created_qr_codes) {
      emitQrCodeEvent(qr, "created");
    }

    res.status(201).json({
      success: true,
      message: "Pod QR codes generated successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error generating pod QR codes by cluster",
    });
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
    emitQrCodeEvent(qr, "updated");
    res.status(200).json({ success: true, message: "Pod QR code updated successfully", data: qr });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating pod QR code" });
  }
};

exports.deleteQrCode = async (req, res) => {
  try {
    const qr = await podQrCodeService.getQrCodeById(req.params.id);
    const result = await podQrCodeService.deleteQrCode(req.params.id);
    emitQrCodeEvent(qr, "deleted");
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting pod QR code" });
  }
};
