const lostFoundService = require("../services/lostFoundService");

const resolveUploadedFile = (req) => {
  if (req.file) return req.file;
  if (req.files && typeof req.files === "object") {
    const photoFile = Array.isArray(req.files.photo) ? req.files.photo[0] : null;
    if (photoFile) return photoFile;
    const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : null;
    if (imageFile) return imageFile;
  }
  return null;
};

exports.createLostFoundItem = async (req, res) => {
  try {
    const uploadedFile = resolveUploadedFile(req);
    const payload = {
      ...req.body,
      photo_buffer: uploadedFile?.buffer || undefined,
      photo_mime_type: uploadedFile?.mimetype || undefined,
    };
    const item = await lostFoundService.createLostFoundItem(payload, req.user);
    res.status(201).json({
      success: true,
      message: "Lost & found item created successfully",
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating lost & found item",
      ...(error.errorCode && { error_code: error.errorCode }),
      ...(error.providerMessage && { provider_error: error.providerMessage }),
    });
  }
};

exports.getLostFoundItems = async (req, res) => {
  try {
    const result = await lostFoundService.getLostFoundItems(req.query);
    const items = Array.isArray(result) ? result : result.items || [];
    const responseBody = {
      success: true,
      count: items.length,
      data: items,
    };

    if (!Array.isArray(result) && result.pagination) {
      responseBody.pagination = result.pagination;
    }

    res.status(200).json(responseBody);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching lost & found items",
    });
  }
};

exports.getMyLostFoundItems = async (req, res) => {
  try {
    const result = await lostFoundService.getMyLostFoundItems(req.query, req.user);
    const items = Array.isArray(result) ? result : result.items || [];
    const responseBody = {
      success: true,
      count: items.length,
      data: items,
    };
    if (!Array.isArray(result) && result.pagination) {
      responseBody.pagination = result.pagination;
    }
    res.status(200).json(responseBody);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching my lost & found items",
    });
  }
};

exports.getLostFoundItemById = async (req, res) => {
  try {
    const item = await lostFoundService.getLostFoundItemById(req.params.id);
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

exports.updateLostFoundStatus = async (req, res) => {
  try {
    const item = await lostFoundService.updateLostFoundStatus(req.params.id, req.body.status, req.user);
    res.status(200).json({
      success: true,
      message: "Lost & found status updated successfully",
      data: item,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating lost & found status",
    });
  }
};
