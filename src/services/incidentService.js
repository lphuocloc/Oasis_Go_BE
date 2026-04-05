const Incident = require("../models/Incidents");
const IncidentPhoto = require("../models/IncidentPhoto");
const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");
const Item = require("../models/Item");
const User = require("../models/User");
const mongoose = require("mongoose");

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

const normalizeIncidentType = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const parsePositiveNumber = (value, fieldName, fallback = null) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError(`${fieldName} must be a positive number`, 400);
  }

  return parsed;
};

const parseNonNegativeNumber = (value, fieldName, fallback = 0) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError(`${fieldName} must be a non-negative number`, 400);
  }

  return parsed;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const isLikelyHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const resolveActorId = (actor) => {
  const ids = [actor?.id, actor?._id].filter(Boolean).map((id) => String(id));
  return ids.length > 0 ? ids[0] : null;
};

const ensureCleanerCanReportOnTask = async (cleaningTaskId, actor) => {
  const task = await CleaningTask.findOne({ id: cleaningTaskId })
    .select("id pod_id booking_id cleaner_id status")
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

const toDamageReportView = (incidentDoc, photoUrls = [], metadata = {}) => {
  const incident = typeof incidentDoc?.toObject === "function" ? incidentDoc.toObject() : incidentDoc;
  const podName = metadata.pod_name || null;
  const userId = metadata.user_id || incident.reported_by || null;
  const userName = metadata.user_name || null;
  const cleanerName = metadata.cleaner_name || userName || null;

  return {
    report_id: incident.id,
    incident_type: incident.incident_type || "DAMAGE_REPORT",
    status: incident.status,
    severity: incident.severity,
    description: incident.description,
    context: {
      pod_id: incident.pod_id || null,
      pod_name: podName,
      booking_id: incident.booking_id || null,
      cleaning_task_id: incident.cleaning_task_id || null,
      reported_by: incident.reported_by || null,
      user_id: userId,
      user_name: userName,
      cleaner_name: cleanerName,
    },
    item: {
      item_id: incident.item_id || null,
      item_name_snapshot: incident.item_name_snapshot || null,
      unit_cost_snapshot: incident.unit_cost_snapshot ?? null,
      quantity_affected: incident.quantity_affected ?? null,
    },
    pricing: {
      estimated_item_value: incident.estimated_item_value ?? null,
      estimated_service_fee: incident.estimated_service_fee ?? 0,
      estimated_total_value: incident.estimated_total_value ?? null,
      currency: "VND",
      pricing_source: incident.pricing_source || null,
    },
    photo_urls: Array.isArray(photoUrls) ? photoUrls : [],
    created_at: incident.created_at || null,
    updated_at: incident.updated_at || null,
  };
};

const buildIncidentPhotoMap = async (incidentIds = []) => {
  if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
    return {};
  }

  const photos = await IncidentPhoto.find({ incident_id: { $in: incidentIds } })
    .select("incident_id photo_url")
    .lean();

  return photos.reduce((map, item) => {
    if (!map[item.incident_id]) map[item.incident_id] = [];
    map[item.incident_id].push(item.photo_url);
    return map;
  }, {});
};

const buildDamageMetadataMap = async (incidents = []) => {
  const podIds = [...new Set(incidents.map((item) => String(item.pod_id || "")).filter(Boolean))];
  const reporterIds = [...new Set(incidents.map((item) => String(item.reported_by || "")).filter(Boolean))];
  const reporterObjectIds = reporterIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const [pods, users] = await Promise.all([
    podIds.length > 0
      ? Pod.find({ id: { $in: podIds } }).select("id name").lean()
      : Promise.resolve([]),
    reporterIds.length > 0
      ? User.find({
          $or: [
            { id: { $in: reporterIds } },
            { _id: { $in: reporterObjectIds } },
          ],
        })
          .select("_id id name")
          .lean()
      : Promise.resolve([]),
  ]);

  const podById = new Map(pods.map((pod) => [String(pod.id), pod]));
  const userById = new Map();
  users.forEach((user) => {
    if (user && user.id) userById.set(String(user.id), user);
    if (user && user._id) userById.set(String(user._id), user);
  });

  const metadataByIncidentId = new Map();
  incidents.forEach((incident) => {
    const pod = podById.get(String(incident.pod_id || "")) || null;
    const user = userById.get(String(incident.reported_by || "")) || null;

    metadataByIncidentId.set(String(incident.id), {
      pod_name: pod ? pod.name || null : null,
      user_id: user ? String(user.id || user._id || incident.reported_by || "") : String(incident.reported_by || ""),
      user_name: user ? user.name || null : null,
      cleaner_name: user ? user.name || null : null,
    });
  });

  return metadataByIncidentId;
};

const resolveDamagePricing = async ({ item_id, quantity_affected, estimated_service_fee }) => {
  const item = await Item.findOne({ id: item_id }).select("id name unit_cost").lean();
  if (!item) {
    throw createError("Item not found", 404);
  }

  const unitCostSnapshot = Number(item.unit_cost) || 0;
  const affectedQuantity = parsePositiveNumber(quantity_affected, "quantity_affected", 1);
  const serviceFee = parseNonNegativeNumber(estimated_service_fee, "estimated_service_fee", 0);
  const estimatedItemValue = unitCostSnapshot * affectedQuantity;
  const estimatedTotalValue = estimatedItemValue + serviceFee;

  return {
    item,
    unitCostSnapshot,
    affectedQuantity,
    serviceFee,
    estimatedItemValue,
    estimatedTotalValue,
  };
};

exports.getIncidents = async (filters = {}) => {
  const query = {};

  if (filters.pod_ids) {
    query.pod_id = { $in: filters.pod_ids.split(",") };
  } else if (filters.pod_id) {
    query.pod_id = filters.pod_id;
  }
  if (filters.cleaning_task_id) query.cleaning_task_id = filters.cleaning_task_id;
  if (filters.booking_id) query.booking_id = filters.booking_id;
  if (filters.reported_by) query.reported_by = filters.reported_by;
  if (filters.incident_type) {
    const incidentType = normalizeIncidentType(filters.incident_type);
    if (!["OPERATIONAL", "DAMAGE_REPORT"].includes(incidentType)) {
      throw createError("Invalid incident_type. Must be one of: OPERATIONAL, DAMAGE_REPORT", 400);
    }
    query.incident_type = incidentType;
  }
  if (filters.item_id) query.item_id = filters.item_id;
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
  const photoMap = await buildIncidentPhotoMap(incidentIds);

  return incidents.map((incident) => toIncidentView(incident, photoMap[incident.id] || []));
};

exports.getDamageReports = async (query = {}) => {
  const filter = {
    incident_type: "DAMAGE_REPORT",
  };

  if (query.pod_ids) {
    filter.pod_id = { $in: query.pod_ids.split(",") };
  } else if (query.pod_id) {
    filter.pod_id = query.pod_id;
  }

  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.cleaning_task_id) filter.cleaning_task_id = query.cleaning_task_id;
  if (query.reported_by) filter.reported_by = query.reported_by;
  if (query.item_id) filter.item_id = query.item_id;

  if (query.severity) {
    const severity = normalizeSeverity(query.severity);
    if (!INCIDENT_SEVERITIES.includes(severity)) {
      throw createError(`Invalid severity. Must be one of: ${INCIDENT_SEVERITIES.join(", ")}`, 400);
    }
    filter.severity = severity;
  }

  if (query.status) {
    const status = normalizeStatus(query.status);
    if (!INCIDENT_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
    }
    filter.status = status;
  }

  if (query.from || query.to) {
    filter.created_at = {};
    if (query.from) {
      const fromDate = new Date(query.from);
      if (Number.isNaN(fromDate.getTime())) throw createError("from must be a valid date", 400);
      filter.created_at.$gte = fromDate;
    }
    if (query.to) {
      const toDate = new Date(query.to);
      if (Number.isNaN(toDate.getTime())) throw createError("to must be a valid date", 400);
      filter.created_at.$lte = toDate;
    }
  }

  const shouldPaginate = query.page !== undefined || query.limit !== undefined;
  if (!shouldPaginate) {
    const incidents = await Incident.find(filter).sort({ created_at: -1 });
    const photoMap = await buildIncidentPhotoMap(incidents.map((item) => item.id));
    const metadataMap = await buildDamageMetadataMap(incidents);

    return {
      items: incidents.map((incident) =>
        toDamageReportView(incident, photoMap[incident.id] || [], metadataMap.get(String(incident.id)) || {})
      ),
      pagination: null,
    };
  }

  const page = parsePositiveInt(query.page, 1);
  const limit = Math.min(parsePositiveInt(query.limit, 20), 100);
  const skip = (page - 1) * limit;

  const [total, incidents] = await Promise.all([
    Incident.countDocuments(filter),
    Incident.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
  ]);

  const photoMap = await buildIncidentPhotoMap(incidents.map((item) => item.id));
  const metadataMap = await buildDamageMetadataMap(incidents);

  return {
    items: incidents.map((incident) =>
      toDamageReportView(incident, photoMap[incident.id] || [], metadataMap.get(String(incident.id)) || {})
    ),
    pagination: {
      current_page: page,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      total_items: total,
      items_per_page: limit,
    },
  };
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

  const session = await mongoose.startSession();
  let incident;

  try {
    incident = await session.withTransaction(async () => {
      const [createdIncident] = await Incident.create(
        [
          {
            pod_id: task.pod_id,
            booking_id: task.booking_id || null,
            cleaning_task_id: task.id,
            reported_by: reporterId,
            description: normalizedDescription,
            severity: normalizedSeverity,
            status: "PENDING",
          },
        ],
        { session }
      );

      if (photoRecords.length > 0) {
        await IncidentPhoto.insertMany(
          photoRecords.map((item) => ({
            incident_id: createdIncident.id,
            photo_url: item.url,
            photo_public_id: item.public_id,
          })),
          { session }
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
          },
          { session }
        );
      }

      return createdIncident;
    });
  } finally {
    session.endSession();
  }

  return toIncidentView(
    incident,
    photoRecords.map((item) => item.url)
  );
};

exports.createDamageReport = async (
  {
    cleaning_task_id,
    pod_id,
    booking_id,
    item_id,
    quantity_affected,
    estimated_service_fee,
    description,
    severity,
    photo_urls = [],
    uploaded_photos = [],
  },
  actor
) => {
  const normalizedDescription = String(description || "").trim();
  if (!normalizedDescription) throw createError("description is required", 400);

  const normalizedSeverity = normalizeSeverity(severity) || "MEDIUM";
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalizedSeverity)) {
    throw createError("Invalid severity. Must be one of: LOW, MEDIUM, HIGH, CRITICAL", 400);
  }

  const resolvedItemId = String(item_id || "").trim();
  if (!resolvedItemId) {
    throw createError("item_id is required", 400);
  }

  let taskContext = null;
  if (cleaning_task_id) {
    taskContext = await ensureCleanerCanReportOnTask(cleaning_task_id, actor);
  }

  let resolvedPodId = String(pod_id || "").trim() || null;
  let resolvedBookingId = String(booking_id || "").trim() || null;

  if (taskContext) {
    resolvedPodId = taskContext.pod_id;
    resolvedBookingId = resolvedBookingId || taskContext.booking_id || null;
  }

  if (!resolvedPodId) {
    throw createError("pod_id is required when cleaning_task_id is not provided", 400);
  }

  const pod = await Pod.findOne({ id: resolvedPodId }).select("id name").lean();
  if (!pod) throw createError("Pod not found", 404);

  const pricing = await resolveDamagePricing({
    item_id: resolvedItemId,
    quantity_affected,
    estimated_service_fee,
  });

  const reporterId = resolveActorId(actor);
  if (!reporterId) throw createError("Unable to resolve reporter identity", 401);

  const reporter = await User.findOne({ $or: [{ id: reporterId }, { _id: reporterId }] })
    .select("id _id isActive name")
    .lean();
  if (!reporter) throw createError("Reporter not found", 404);
  if (!reporter.isActive) throw createError("Reporter is inactive", 403);

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

  const session = await mongoose.startSession();
  let incident;

  try {
    incident = await session.withTransaction(async () => {
      const [createdIncident] = await Incident.create(
        [
          {
            pod_id: resolvedPodId,
            booking_id: resolvedBookingId,
            cleaning_task_id: taskContext ? taskContext.id : null,
            reported_by: reporterId,
            incident_type: "DAMAGE_REPORT",
            description: normalizedDescription,
            severity: normalizedSeverity,
            status: "PENDING",
            item_id: pricing.item.id,
            item_name_snapshot: pricing.item.name,
            unit_cost_snapshot: pricing.unitCostSnapshot,
            quantity_affected: pricing.affectedQuantity,
            estimated_item_value: pricing.estimatedItemValue,
            estimated_service_fee: pricing.serviceFee,
            estimated_total_value: pricing.estimatedTotalValue,
            pricing_source: "ITEM_UNIT_COST",
          },
        ],
        { session }
      );

      if (photoRecords.length > 0) {
        await IncidentPhoto.insertMany(
          photoRecords.map((item) => ({
            incident_id: createdIncident.id,
            photo_url: item.url,
            photo_public_id: item.public_id,
          })),
          { session }
        );
      }

      return createdIncident;
    });
  } finally {
    session.endSession();
  }

  return toDamageReportView(
    incident,
    photoRecords.map((item) => item.url),
    {
      pod_name: pod.name || null,
      user_id: String(reporter.id || reporter._id || reporterId),
      user_name: reporter.name || null,
      cleaner_name: reporter.name || null,
    }
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

  if (actorRole === "manager" && actor.managerScope) {
    if (!actor.managerScope.podIds.includes(String(incident.pod_id))) {
      throw createError("You are not allowed to update an incident out of your management scope", 403);
    }
  }

  incident.status = normalizedStatus;
  await incident.save();

  return incident;
};

