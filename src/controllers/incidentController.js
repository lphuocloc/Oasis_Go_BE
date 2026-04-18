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
    }));
};

const cleanupUploadedPhotos = async (uploadedPhotos = []) => {
  if (!Array.isArray(uploadedPhotos) || uploadedPhotos.length === 0) return;

  await Promise.all(
    uploadedPhotos
      .filter((item) => item.public_id)
      .map((item) => cloudinary.uploader.destroy(item.public_id).catch(() => null))
  );
};

const mapSettlementReasonToWarningMessage = (reason) => {
  const reasonCode = String(reason || "").trim().toUpperCase();

  const messageByReason = {
    MISSING_ORDER_ID: "Incident da duoc cap nhat, nhung khong tim thay order de doi soat coc.",
    ORDER_NOT_FOUND: "Incident da duoc cap nhat, nhung order khong ton tai de doi soat coc.",
    ORDER_NOT_ELIGIBLE: "Incident da duoc cap nhat, nhung order chua du dieu kien de doi soat coc.",
    ORDER_ALREADY_SETTLED: "Incident da duoc cap nhat, nhung tien coc cua order nay da duoc doi soat truoc do.",
    ORDER_BOOKINGS_NOT_FOUND: "Incident da duoc cap nhat, nhung order khong co booking de doi soat coc.",
    ORDER_BOOKINGS_NOT_TERMINAL: "Incident da duoc cap nhat, nhung booking trong order chua ket thuc nen chua doi soat coc.",
    CLEANING_NOT_COMPLETED: "Incident da duoc cap nhat, nhung cleaning task chua hoan tat nen chua doi soat coc.",
    PENDING_INCIDENT_EXISTS: "Incident da duoc cap nhat, nhung van con incident PENDING nen chua doi soat coc.",
    BOOKING_ORDER_NOT_FOUND: "Incident da duoc cap nhat, nhung khong tim thay booking order lien quan.",
    SETTLEMENT_NOT_APPLIED: "Incident da duoc cap nhat, nhung chua doi soat coc cho don hang.",
  };

  return messageByReason[reasonCode] || "Incident da duoc cap nhat, nhung chua doi soat coc cho don hang.";
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
        message: "Not authorized. Please login to access this resource.",
      });
    }

    const incident = await incidentService.updateIncidentStatus(req.params.id, req.body, actor);

    let warning;
    if (
      incident?.damage_billing &&
      incident.damage_billing.settlement_applied === false &&
      incident.damage_billing.settlement_reason
    ) {
      warning = {
        code: "DEPOSIT_SETTLEMENT_NOT_APPLIED",
        reason: String(incident.damage_billing.settlement_reason),
        message: mapSettlementReasonToWarningMessage(incident.damage_billing.settlement_reason),
      };
    }

    res.status(200).json({
      success: true,
      message: "Incident status updated successfully",
      data: incident,
      warning,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating incident status",
    });
  }
};
