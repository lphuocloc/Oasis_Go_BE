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

exports.createIncidentFromCleaningTask = async (req, res) => {
  const uploadedPhotos = Array.isArray(req.files)
    ? req.files
        .filter((file) => file && file.path)
        .map((file) => ({
          url: file.path,
          public_id: file.filename || null,
        }))
    : [];

  try {
    const incident = await incidentService.createIncidentFromCleaningTask(
      {
        ...req.body,
        photo_urls: parsePhotoUrls(req.body.photo_urls),
        uploaded_photos: uploadedPhotos,
      },
      req.user
    );

    res.status(201).json({
      success: true,
      message: "Incident created successfully",
      data: incident,
    });
  } catch (error) {
    if (uploadedPhotos.length > 0) {
      await Promise.all(
        uploadedPhotos
          .filter((item) => item.public_id)
          .map((item) => cloudinary.uploader.destroy(item.public_id).catch(() => null))
      );
    }

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating incident",
    });
  }
};

exports.getIncidents = async (req, res) => {
  try {
    const incidents = await incidentService.getIncidents(req.query);
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
    const incident = await incidentService.getIncidentById(req.params.id);

    if (req.user && req.user.role === "manager" && req.managerScope) {
      if (!req.managerScope.podIds.includes(String(incident.pod_id))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to access an incident out of your management scope",
        });
      }
    }

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
    const actor = req.user ? { ...req.user, managerScope: req.managerScope } : null;
    const incident = await incidentService.updateIncidentStatus(req.params.id, req.body.status, actor);
    res.status(200).json({
      success: true,
      message: "Incident status updated successfully",
      data: incident,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating incident status",
    });
  }
};
