const lostFoundService = require("../services/lostFoundService");

// Xử lý file upload trực tiếp (nếu có multipart)
const resolveUploadedPhotos = (req) => {
  if (req.files && Array.isArray(req.files)) {
    return req.files.map(file => ({
      url: file.path,
      public_id: file.filename || null,
      file_type: String(file.mimetype || "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE",
    }));
  }
  return [];
};

// ─── Luồng Cleaner ──────────────────────────────────────────────────

exports.reportFoundItem = async (req, res) => {
  try {
    const uploadedPhotos = resolveUploadedPhotos(req);

    const payload = {
      ...req.body,
      uploaded_photos: uploadedPhotos,
    };
    const item = await lostFoundService.reportFoundItem(payload, req.user);
    res.status(201).json({
      success: true,
      message: "Lost & found item reported successfully",
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error reporting found item",
    });
  }
};

// ─── Luồng Manager ──────────────────────────────────────────────────

exports.storeToWarehouse = async (req, res) => {
  try {
    const item = await lostFoundService.storeToWarehouse(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Item stored to warehouse successfully",
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error storing item",
    });
  }
};

exports.confirmMatch = async (req, res) => {
  try {
    const result = await lostFoundService.confirmMatch(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Item matched successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error matching item",
    });
  }
};

exports.rejectLostItemRequest = async (req, res) => {
  try {
    const request = await lostFoundService.rejectLostItemRequest(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Lost item request rejected",
      data: request,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error rejecting request",
    });
  }
};

exports.closeLostItemRequest = async (req, res) => {
  try {
    const request = await lostFoundService.closeLostItemRequest(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Lost item request closed",
      data: request,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error closing request",
    });
  }
};

exports.generateHandoverOTP = async (req, res) => {
  try {
    const result = await lostFoundService.generateHandoverOTP(req.params.id, req.user);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error generating OTP",
    });
  }
};

exports.confirmHandover = async (req, res) => {
  try {
    const item = await lostFoundService.confirmHandover(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: "Item handover completed successfully",
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error confirming handover",
    });
  }
};

// ─── Luồng User ─────────────────────────────────────────────────────

exports.submitLostItemRequest = async (req, res) => {
  try {
    const request = await lostFoundService.submitLostItemRequest(req.body, req.user);
    res.status(201).json({
      success: true,
      message: "Tạo yêu cầu tìm đồ thành công",
      data: request,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Lỗi khi tạo yêu cầu tìm đồ",
    });
  }
};

// ─── GET APIs ───────────────────────────────────────────────────────

exports.getLostFoundItems = async (req, res) => {
  try {
    const result = await lostFoundService.getLostFoundItems(req.query, req.user);
    res.status(200).json({
      success: true,
      count: result.items ? result.items.length : 0,
      data: result.items || [],
      pagination: result.pagination || undefined,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching lost & found items",
    });
  }
};

exports.getLostFoundItemById = async (req, res) => {
  try {
    const item = await lostFoundService.getLostFoundItemById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching lost & found item",
    });
  }
};

exports.getLostItemRequests = async (req, res) => {
  try {
    const result = await lostFoundService.getLostItemRequests(req.query, req.user);
    res.status(200).json({
      success: true,
      count: result.items ? result.items.length : 0,
      data: result.items || [],
      pagination: result.pagination || undefined,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching requests",
    });
  }
};

exports.getLostItemRequestById = async (req, res) => {
  try {
    const request = await lostFoundService.getLostItemRequestById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: request,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching request",
    });
  }
};
