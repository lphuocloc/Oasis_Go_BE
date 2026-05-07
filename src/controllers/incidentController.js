const incidentService = require("../services/incidentService");
const { cloudinary } = require("../config/cloudinary");

const parsePhotoUrls = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      // Fall through to comma-separated parsing.
    }

    if (trimmed.includes(",")) {
      return trimmed.split(",").map((item) => item.trim());
    }

    return [trimmed];
  }

  return [];
};

const buildUploadedPhotos = (files) => {
  if (!Array.isArray(files)) return [];

  return files
    .filter((file) => file && file.path)
    .map((file) => ({
      url: file.path,
      public_id: file.filename || null,
      file_type: String(file.mimetype || "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE",
    }));
};

const cleanupUploadedPhotos = async (uploadedPhotos = []) => {
  if (!Array.isArray(uploadedPhotos) || uploadedPhotos.length === 0) return;

  await Promise.all(
    uploadedPhotos
      .filter((item) => item.public_id)
      .map((item) => {
        const resourceType = item.file_type === "VIDEO" ? "video" : "image";
        return cloudinary.uploader.destroy(item.public_id, { resource_type: resourceType }).catch(() => null);
      })
  );
};



const createDamageIncident = async (req, res, { successMessage = "Incident created successfully" } = {}) => {
  const uploadedPhotos = buildUploadedPhotos(req.files);

  try {
    const incident = await incidentService.createDamageReport(
      {
        ...req.body,
        photo_urls: parsePhotoUrls(req.body.photo_urls),
        uploaded_photos: uploadedPhotos,
      },
      req.user
    );

    res.status(201).json({
      success: true,
      message: successMessage,
      data: incident,
    });
  } catch (error) {
    await cleanupUploadedPhotos(uploadedPhotos);

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating incident",
    });
  }
};

exports.createIncident = async (req, res) => createDamageIncident(req, res, {
  successMessage: "Incident created successfully",
});

exports.getDamageReports = async (req, res) => {
  try {
    const result = await incidentService.getDamageReports(req.query, req.user);
    res.status(200).json({
      success: true,
      count: Array.isArray(result.items) ? result.items.length : 0,
      data: result.items || [],
      pagination: result.pagination || undefined,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching damage reports",
    });
  }
};

exports.getMyPendingIncidentReviews = async (req, res) => {
  try {
    const query = {
      ...req.query,
      status: "PENDING",
    };

    const result = await incidentService.getDamageReports(query, req.user);
    res.status(200).json({
      success: true,
      count: Array.isArray(result.items) ? result.items.length : 0,
      data: result.items || [],
      pagination: result.pagination || undefined,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching pending incident reviews",
    });
  }
};

exports.getIncidents = async (req, res) => {
  try {
    const incidents = await incidentService.getIncidents(req.query, req.user);
    res.status(200).json({
      success: true,
      count: incidents.length,
      data: incidents,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching incidents",
    });
  }
};

exports.getIncidentById = async (req, res) => {
  try {
    const incident = await incidentService.getIncidentById(req.params.id, req.user, req.managerScope);

    res.status(200).json({
      success: true,
      data: incident,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching incident",
    });
  }
};

exports.updateIncidentStatus = async (req, res) => {
  try {
    const baseActor = req.user
      ? (typeof req.user.toObject === "function" ? req.user.toObject() : req.user)
      : null;
    const actor = baseActor ? { ...baseActor, managerScope: req.managerScope || null } : null;

    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Không được phép. Vui lòng đăng nhập để truy cập tài nguyên này.",
      });
    }

    const incident = await incidentService.updateIncidentStatus(req.params.id, req.body, actor);

    res.status(200).json({
      success: true,
      message: "Cập nhật trạng thái sự cố thành công",
      data: incident,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Lỗi khi cập nhật trạng thái sự cố",
    });
  }
};

exports.resolveReplenishment = async (req, res) => {
  try {
    const cleanerId = req.user.id || String(req.user._id);
    const incidentId = req.params.id;
    const { items } = req.body;

    const result = await incidentService.resolveReplenishmentIncident(incidentId, cleanerId, items);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Lỗi khi giải quyết sự cố bổ sung",
    });
  }
};

// ─── Cleaner Incident Controllers ─────────────────────────────────

exports.getCleanerIncidents = async (req, res) => {
  try {
    const incidents = await incidentService.getCleanerIncidents(req.user, req.query);
    res.status(200).json({
      success: true,
      count: incidents.length,
      data: incidents,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Lỗi khi fetching sự cố của người dọn dẹp",
    });
  }
};

exports.getCleanerIncidentDetail = async (req, res) => {
  try {
    const incident = await incidentService.getCleanerIncidentDetail(req.params.id, req.user);
    res.status(200).json({ success: true, data: incident });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Lỗi khi fetching chi tiết sự cố",
    });
  }
};

exports.getReplenishmentRequestsByCleaner = async (req, res) => {
  try {
    const { cleaning_task_id } = req.query;
    const result = await incidentService.getReplenishmentRequestsByCleaner(cleaning_task_id, req.user);
    res.status(200).json({
      success: true,
      count: result.incidents.length,
      data: result,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Error fetching replenishment requests",
    });
  }
};

exports.updateCleanerIncidentStatus = async (req, res) => {
  try {
    const result = await incidentService.updateCleanerIncidentStatus(
      req.params.id,
      req.body,
      req.user
    );
    res.status(200).json({
      success: true,
      message: "Cập nhật trạng thái sự cố thành công",
      data: result,
    });
  } catch (error) {
    if (!error.statusCode) {
      console.error("[updateCleanerIncidentStatus] Unexpected error:", error);
    }
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Lỗi khi cập nhật trạng thái sự cố",
    });
  }
};
