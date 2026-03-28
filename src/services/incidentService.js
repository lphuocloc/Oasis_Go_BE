const Incident = require("../models/Incidents");
const IncidentPhoto = require("../models/IncidentPhoto");
const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");
const User = require("../models/User");

const INCIDENT_STATUSES = ["PENDING", "INVESTIGATING", "RESOLVED", "CLOSED"];
const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeStatus = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const normalizeSeverity = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const isLikelyHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const resolveActorId = (actor) => {
  const ids = [actor?.id, actor?._id].filter(Boolean).map((id) => String(id));
  return ids.length > 0 ? ids[0] : null;
};

const ensureCleanerCanReportOnTask = async (cleaningTaskId, actor) => {
  const task = await CleaningTask.findOne({ id: cleaningTaskId })
    .select("id pod_id booking_id cleaner_id shift_assignment_id status")
    .lean();

  if (!task) throw createError("Cleaning task not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = [actor?.id, actor?._id].filter(Boolean).map((value) => String(value));

  if (actorRole === "cleaner") {
    const isOwner = actorIds.includes(String(task.cleaner_id));
    if (!isOwner) {
      throw createError("You are not allowed to report incident for this cleaning task", 403);
    }

    if (String(task.status || "").toUpperCase() !== "IN_PROGRESS") {
      throw createError("Incident can only be reported when cleaning task is IN_PROGRESS", 400);
    }
  }

  return task;
};

const toIncidentView = (incidentDoc, photoUrls = []) => {
  const incident = typeof incidentDoc?.toObject === "function" ? incidentDoc.toObject() : incidentDoc;
  return {
    ...incident,
    photo_urls: Array.isArray(photoUrls) ? photoUrls : [],
  };
};

exports.getIncidents = async (filters = {}) => {
  const query = {};

  if (filters.pod_id) query.pod_id = filters.pod_id;
  if (filters.cleaning_task_id) query.cleaning_task_id = filters.cleaning_task_id;
  if (filters.booking_id) query.booking_id = filters.booking_id;
  if (filters.reported_by) query.reported_by = filters.reported_by;
  if (filters.status) {
    const status = normalizeStatus(filters.status);
    if (!INCIDENT_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
    }
    query.status = status;
  }

  const incidents = await Incident.find(query).sort({ created_at: -1 });
  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((item) => item.id);
  const photos = await IncidentPhoto.find({ incident_id: { $in: incidentIds } })
    .select("incident_id photo_url")
    .lean();

  const photoMap = photos.reduce((map, item) => {
    if (!map[item.incident_id]) map[item.incident_id] = [];
    map[item.incident_id].push(item.photo_url);
    return map;
  }, {});

  return incidents.map((incident) => toIncidentView(incident, photoMap[incident.id] || []));
};

exports.getIncidentById = async (incidentId) => {
  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  const photos = await IncidentPhoto.find({ incident_id: incidentId }).select("photo_url -_id").lean();
  return toIncidentView(
    incident,
    photos.map((item) => item.photo_url)
  );
};

exports.createIncidentFromCleaningTask = async (
  { cleaning_task_id, description, severity, photo_urls = [], uploaded_photos = [] },
  actor
) => {
  if (!cleaning_task_id) throw createError("cleaning_task_id is required", 400);

  const normalizedDescription = String(description || "").trim();
  if (!normalizedDescription) throw createError("description is required", 400);

  const normalizedSeverity = normalizeSeverity(severity) || "MEDIUM";
  if (!INCIDENT_SEVERITIES.includes(normalizedSeverity)) {
    throw createError(`Invalid severity. Must be one of: ${INCIDENT_SEVERITIES.join(", ")}`, 400);
  }

  const reporterId = resolveActorId(actor);
  if (!reporterId) throw createError("Unable to resolve reporter identity", 401);

  const [task, reporter, pod] = await Promise.all([
    ensureCleanerCanReportOnTask(cleaning_task_id, actor),
    User.findOne({ $or: [{ id: reporterId }, { _id: reporterId }] }).select("id _id isActive").lean(),
    CleaningTask.findOne({ id: cleaning_task_id }).select("pod_id").lean().then((t) =>
      t ? Pod.findOne({ id: t.pod_id }).select("id status maintenance_status").lean() : null
    ),
  ]);

  if (!reporter) throw createError("Reporter not found", 404);
  if (!reporter.isActive) throw createError("Reporter is inactive", 403);
  if (!pod) throw createError("Pod not found", 404);

  const incident = await Incident.create({
    pod_id: task.pod_id,
    booking_id: task.booking_id || null,
    cleaning_task_id: task.id,
    shift_assignment_id: task.shift_assignment_id || null,
    reported_by: reporterId,
    description: normalizedDescription,
    severity: normalizedSeverity,
    status: "PENDING",
    has_lost_found: false,
  });

  const normalizedPhotoUrls = Array.isArray(photo_urls)
    ? photo_urls.map((url) => String(url || "").trim()).filter(Boolean)
    : [];

  const normalizedUploadedPhotos = Array.isArray(uploaded_photos)
    ? uploaded_photos
        .filter((item) => item && item.url)
        .map((item) => ({
          url: String(item.url || "").trim(),
          public_id: item.public_id ? String(item.public_id).trim() : null,
        }))
        .filter((item) => item.url)
    : [];

  const photoRecords = [
    ...normalizedUploadedPhotos,
    ...normalizedPhotoUrls.map((url) => ({ url, public_id: null })),
  ]
    .filter((item) => isLikelyHttpUrl(item.url))
    .reduce((acc, item) => {
      if (!acc.some((existing) => existing.url === item.url)) {
        acc.push(item);
      }
      return acc;
    }, []);

  if (photoRecords.length > 0) {
    await IncidentPhoto.insertMany(
      photoRecords.map((item) => ({
        incident_id: incident.id,
        photo_url: item.url,
        photo_public_id: item.public_id,
      }))
    );
  }

  if (["HIGH", "CRITICAL"].includes(normalizedSeverity)) {
    await Pod.updateOne(
      { id: task.pod_id },
      {
        $set: {
          status: "MAINTENANCE",
          maintenance_status: normalizedDescription.slice(0, 255),
        },
      }
    );
  }

  return toIncidentView(
    incident,
    photoRecords.map((item) => item.url)
  );
};

exports.updateIncidentStatus = async (incidentId, status, actor = null) => {
  const normalizedStatus = normalizeStatus(status);
  if (!INCIDENT_STATUSES.includes(normalizedStatus)) {
    throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
  }

  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = [actor?.id, actor?._id].filter(Boolean).map((value) => String(value));
  const isOwner = actorIds.includes(String(incident.reported_by));

  if (actorRole === "cleaner" && !isOwner) {
    throw createError("You are not allowed to update this incident", 403);
  }

  incident.status = normalizedStatus;
  await incident.save();

  return incident;
};

