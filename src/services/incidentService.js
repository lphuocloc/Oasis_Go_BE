const Incident = require("../models/Incidents");
const IncidentDetail = require("../models/IncidentDetail");
const IncidentPhoto = require("../models/IncidentPhoto");
const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const Transaction = require("../models/Transaction");
const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Item = require("../models/Item");
const DamageServiceCatalog = require("../models/DamageServiceCatalog");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const User = require("../models/User");
const mongoose = require("mongoose");
const notificationService = require("./notificationService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");

const INCIDENT_STATUSES = ["PENDING", "RESOLVED", "DISMISSED"];
const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const INCIDENT_TYPES = ["OPERATIONAL", "DAMAGE_REPORT"];
const INCIDENT_DETAIL_TYPES = ["ITEM", "SERVICE"];

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

const normalizeIncidentDetailType = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
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

const parseRequiredPositiveInt = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
};

const isLikelyHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const resolveActorId = (actor) => {
  const ids = [actor?.id, actor?._id].filter(Boolean).map((id) => String(id));
  return ids.length > 0 ? ids[0] : null;
};

const resolveActorIdentityIds = (actor) => {
  return [...new Set([actor?.id, actor?._id].filter(Boolean).map((id) => String(id)))];
};

const roundMoney = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
};

const getIncidentDamageTotal = async (incident) => {
  const estimated = Number(incident?.estimated_total_value);
  if (Number.isFinite(estimated) && estimated >= 0) {
    return roundMoney(estimated);
  }

  const detailRows = await IncidentDetail.find({ incident_id: incident.id })
    .select("total_cost")
    .lean();

  const total = detailRows.reduce((sum, row) => sum + Number(row?.total_cost || 0), 0);
  return roundMoney(Math.max(0, total));
};

const getOrCreateWalletByUserId = async (userId, session = null) => {
  let walletQuery = Wallet.findOne({ user_id: userId });
  if (session) walletQuery = walletQuery.session(session);
  let wallet = await walletQuery;

  if (!wallet) {
    const created = await Wallet.create(
      [
        {
          user_id: userId,
          balance: 0,
          status: "ACTIVE",
        },
      ],
      session ? { session } : {}
    );
    wallet = created[0];
  }

  return wallet;
};

const parseIncidentDetailsPayload = ({ details }) => {
  let parsedDetails = details;

  if (typeof parsedDetails === "string") {
    const trimmed = parsedDetails.trim();
    if (trimmed) {
      try {
        parsedDetails = JSON.parse(trimmed);
      } catch (_) {
        throw createError("details must be a valid JSON array", 400);
      }
    } else {
      parsedDetails = [];
    }
  }

  if (parsedDetails && !Array.isArray(parsedDetails) && typeof parsedDetails === "object") {
    parsedDetails = [parsedDetails];
  }

  return Array.isArray(parsedDetails) ? parsedDetails : [];
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

const resolveManagersForPod = async (podId) => {
  if (!podId) return [];

  const pod = await Pod.findOne({ id: podId }).select("cluster_id code name").lean();
  if (!pod) return [];

  const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("location_id").lean();
  if (!cluster || !cluster.location_id) return [];

  const locationShifts = await LocationShift.find({ location_id: cluster.location_id }).select("id shift_id").lean();
  if (!locationShifts.length) return [];

  const shiftIds = [...new Set(locationShifts.map((entry) => String(entry.shift_id || "")).filter(Boolean))];
  const managerShiftIds = await StaffShift.find({ id: { $in: shiftIds }, role: "MANAGER", is_active: true })
    .select("id")
    .lean()
    .then((rows) => rows.map((row) => String(row.id)));

  if (!managerShiftIds.length) return [];

  const managerLocationShiftIds = locationShifts
    .filter((entry) => managerShiftIds.includes(String(entry.shift_id)))
    .map((entry) => String(entry.id));

  if (!managerLocationShiftIds.length) return [];

  const now = new Date();
  const assignments = await StaffShiftAssignment.find({
    location_shift_id: { $in: managerLocationShiftIds },
    status: "ASSIGNED",
    start_date: { $lte: now },
    end_date: { $gte: now },
  })
    .select("staff_id")
    .lean();

  const assignmentStaffIds = [...new Set(assignments.map((entry) => String(entry.staff_id || "")).filter(Boolean))];
  if (!assignmentStaffIds.length) return [];

  const assignmentObjectIds = assignmentStaffIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const managers = await User.find({
    role: "manager",
    isActive: true,
    $or: [{ id: { $in: assignmentStaffIds } }, { _id: { $in: assignmentObjectIds } }],
  })
    .select("_id")
    .lean();

  return [...new Set(managers.map((manager) => String(manager._id || "")).filter(Boolean))];
};

const toIncidentView = (incidentDoc, photoUrls = [], details = []) => {
  const incident = typeof incidentDoc?.toObject === "function" ? incidentDoc.toObject() : incidentDoc;

  const safeDetails = Array.isArray(details) ? details : [];

  return {
    ...incident,
    photo_urls: Array.isArray(photoUrls) ? photoUrls : [],
    details: safeDetails,
  };
};

const toDamageReportView = (incidentDoc, photoUrls = [], metadata = {}, details = []) => {
  const incident = typeof incidentDoc?.toObject === "function" ? incidentDoc.toObject() : incidentDoc;
  const podName = metadata.pod_name || null;
  const userId = metadata.user_id || incident.reported_by || null;
  const userName = metadata.user_name || null;
  const cleanerName = metadata.cleaner_name || userName || null;
  const safeDetails = Array.isArray(details) ? details : [];
  const itemDetails = safeDetails.filter((detail) => detail.type === "ITEM");
  const serviceDetails = safeDetails.filter((detail) => detail.type === "SERVICE");
  const estimatedItemValue = itemDetails.reduce((sum, item) => sum + (Number(item.total_cost) || 0), 0);
  const estimatedServiceFromDetails = serviceDetails.reduce((sum, item) => sum + (Number(item.total_cost) || 0), 0);
  const serviceFee = incident.estimated_service_fee ?? 0;
  const estimatedTotalValue = incident.estimated_total_value ?? estimatedItemValue + serviceFee;

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
    details: safeDetails,
    pricing: {
      estimated_item_value: estimatedItemValue,
      estimated_service_fee: serviceFee || estimatedServiceFromDetails,
      estimated_total_value: estimatedTotalValue,
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

const buildIncidentDetailMap = async (incidentIds = []) => {
  if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
    return {};
  }

  const details = await IncidentDetail.find({ incident_id: { $in: incidentIds } })
    .select("incident_id type item_id service_catalog_id name_snapshot unit_cost_snapshot quantity total_cost note")
    .lean();

  return details.reduce((map, item) => {
    if (!map[item.incident_id]) map[item.incident_id] = [];
    map[item.incident_id].push(item);
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

const resolveIncidentDetails = async (detailsPayload = []) => {
  if (!Array.isArray(detailsPayload) || detailsPayload.length === 0) {
    throw createError("details is required and must contain at least one entry", 400);
  }

  const itemIds = [
    ...new Set(
      detailsPayload
        .filter((entry) => normalizeIncidentDetailType(entry?.type || "ITEM") === "ITEM")
        .map((entry) => String(entry?.item_id || "").trim())
        .filter(Boolean)
    ),
  ];

  const serviceCatalogIds = [
    ...new Set(
      detailsPayload
        .filter((entry) => normalizeIncidentDetailType(entry?.type) === "SERVICE")
        .map((entry) => String(entry?.service_catalog_id || "").trim())
        .filter(Boolean)
    ),
  ];

  const [items, serviceCatalogs] = await Promise.all([
    itemIds.length > 0 ? Item.find({ id: { $in: itemIds } }).select("id name unit_cost").lean() : Promise.resolve([]),
    serviceCatalogIds.length > 0
      ? DamageServiceCatalog.find({ id: { $in: serviceCatalogIds }, is_active: true })
        .select("id name base_price")
        .lean()
      : Promise.resolve([]),
  ]);

  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const serviceById = new Map(serviceCatalogs.map((service) => [String(service.id), service]));

  const missingItemId = itemIds.find((id) => !itemById.has(id));
  if (missingItemId) throw createError(`Item not found: ${missingItemId}`, 404);

  const missingServiceCatalogId = serviceCatalogIds.find((id) => !serviceById.has(id));
  if (missingServiceCatalogId) throw createError(`Damage service catalog not found: ${missingServiceCatalogId}`, 404);

  const resolved = detailsPayload.map((entry, index) => {
    const detailType = normalizeIncidentDetailType(entry?.type || "ITEM");
    if (!INCIDENT_DETAIL_TYPES.includes(detailType)) {
      throw createError(
        `Invalid details[${index}].type. Must be one of: ${INCIDENT_DETAIL_TYPES.join(", ")}`,
        400
      );
    }

    const quantityValue = entry?.quantity ?? 1;
    const parsedQuantity = parseRequiredPositiveInt(quantityValue, `details[${index}].quantity`);

    if (detailType === "ITEM") {
      const resolvedItemId = String(entry?.item_id || "").trim();
      if (!resolvedItemId) throw createError(`details[${index}].item_id is required for ITEM type`, 400);

      const matchedItem = itemById.get(resolvedItemId);
      const unitCostSnapshot = Number(matchedItem.unit_cost) || 0;
      const totalCost = unitCostSnapshot * parsedQuantity;

      return {
        type: "ITEM",
        item_id: matchedItem.id,
        service_catalog_id: null,
        name_snapshot: matchedItem.name,
        unit_cost_snapshot: unitCostSnapshot,
        quantity: parsedQuantity,
        total_cost: totalCost,
        note: entry?.note ? String(entry.note).trim() : null,
      };
    }

    const resolvedCatalogId = String(entry?.service_catalog_id || "").trim();
    const matchedService = resolvedCatalogId ? serviceById.get(resolvedCatalogId) : null;
    const resolvedName = String(entry?.name_snapshot || matchedService?.name || "").trim();
    if (!resolvedName) throw createError(`details[${index}].name_snapshot is required for SERVICE type`, 400);

    const unitCostSnapshot = parseNonNegativeNumber(
      entry?.unit_cost_snapshot !== undefined ? entry.unit_cost_snapshot : matchedService?.base_price,
      `details[${index}].unit_cost_snapshot`,
      null
    );

    if (unitCostSnapshot === null) {
      throw createError(`details[${index}].unit_cost_snapshot is required for SERVICE type`, 400);
    }

    const totalCost = unitCostSnapshot * parsedQuantity;
    return {
      type: "SERVICE",
      item_id: null,
      service_catalog_id: resolvedCatalogId || null,
      name_snapshot: resolvedName,
      unit_cost_snapshot: unitCostSnapshot,
      quantity: parsedQuantity,
      total_cost: totalCost,
      note: entry?.note ? String(entry.note).trim() : null,
    };
  });

  const estimatedItemValue = resolved
    .filter((entry) => entry.type === "ITEM")
    .reduce((sum, entry) => sum + entry.total_cost, 0);
  const estimatedServiceValue = resolved
    .filter((entry) => entry.type === "SERVICE")
    .reduce((sum, entry) => sum + entry.total_cost, 0);

  return { resolved, estimatedItemValue, estimatedServiceValue };
};

const buildIncidentIdsByItemFilter = async (itemId) => {
  const resolvedItemId = String(itemId || "").trim();
  if (!resolvedItemId) return null;

  const matchedIncidentIds = await IncidentDetail.find({
    item_id: resolvedItemId,
    type: "ITEM",
  }).distinct("incident_id");
  if (!Array.isArray(matchedIncidentIds) || matchedIncidentIds.length === 0) {
    return [];
  }

  return [...new Set(matchedIncidentIds.map((id) => String(id)).filter(Boolean))];
};

exports.getIncidents = async (filters = {}, actor = null) => {
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
    if (!INCIDENT_TYPES.includes(incidentType)) {
      throw createError("Invalid incident_type. Must be one of: OPERATIONAL, DAMAGE_REPORT", 400);
    }
    query.incident_type = incidentType;
  }
  if (filters.item_id) {
    const incidentIds = await buildIncidentIdsByItemFilter(filters.item_id);
    if (Array.isArray(incidentIds) && incidentIds.length === 0) return [];
    if (Array.isArray(incidentIds)) query.id = { $in: incidentIds };
  }
  if (filters.status) {
    const status = normalizeStatus(filters.status);
    if (!INCIDENT_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
    }
    query.status = status;
  }

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole === "cleaner") {
    const actorIds = resolveActorIdentityIds(actor);
    if (actorIds.length === 0) {
      throw createError("Unable to resolve actor identity", 401);
    }
    query.reported_by = actorIds.length === 1 ? actorIds[0] : { $in: actorIds };
  }

  const incidents = await Incident.find(query).sort({ created_at: -1 });
  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((item) => item.id);
  const [photoMap, detailMap] = await Promise.all([
    buildIncidentPhotoMap(incidentIds),
    buildIncidentDetailMap(incidentIds),
  ]);

  return incidents.map((incident) =>
    toIncidentView(incident, photoMap[incident.id] || [], detailMap[incident.id] || [])
  );
};

exports.getDamageReports = async (query = {}, actor = null) => {
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
  if (query.item_id) {
    const incidentIds = await buildIncidentIdsByItemFilter(query.item_id);
    if (Array.isArray(incidentIds) && incidentIds.length === 0) {
      return {
        items: [],
        pagination: query.page !== undefined || query.limit !== undefined
          ? {
            current_page: parsePositiveInt(query.page, 1),
            total_pages: 0,
            total_items: 0,
            items_per_page: Math.min(parsePositiveInt(query.limit, 20), 100),
          }
          : null,
      };
    }
    if (Array.isArray(incidentIds)) filter.id = { $in: incidentIds };
  }

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

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole === "cleaner") {
    const actorIds = resolveActorIdentityIds(actor);
    if (actorIds.length === 0) {
      throw createError("Unable to resolve actor identity", 401);
    }
    filter.reported_by = actorIds.length === 1 ? actorIds[0] : { $in: actorIds };
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
    const incidentIds = incidents.map((item) => item.id);
    const [photoMap, metadataMap, detailMap] = await Promise.all([
      buildIncidentPhotoMap(incidentIds),
      buildDamageMetadataMap(incidents),
      buildIncidentDetailMap(incidentIds),
    ]);

    return {
      items: incidents.map((incident) =>
        toDamageReportView(
          incident,
          photoMap[incident.id] || [],
          metadataMap.get(String(incident.id)) || {},
          detailMap[incident.id] || []
        )
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

  const incidentIds = incidents.map((item) => item.id);
  const [photoMap, metadataMap, detailMap] = await Promise.all([
    buildIncidentPhotoMap(incidentIds),
    buildDamageMetadataMap(incidents),
    buildIncidentDetailMap(incidentIds),
  ]);

  return {
    items: incidents.map((incident) =>
      toDamageReportView(
        incident,
        photoMap[incident.id] || [],
        metadataMap.get(String(incident.id)) || {},
        detailMap[incident.id] || []
      )
    ),
    pagination: {
      current_page: page,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      total_items: total,
      items_per_page: limit,
    },
  };
};

exports.getIncidentById = async (incidentId, actor = null, managerScope = null) => {
  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole === "manager" && managerScope) {
    if (!Array.isArray(managerScope.podIds) || !managerScope.podIds.includes(String(incident.pod_id))) {
      throw createError("You are not allowed to access an incident out of your management scope", 403);
    }
  }

  if (actorRole === "cleaner") {
    const actorIds = resolveActorIdentityIds(actor);
    if (actorIds.length === 0) {
      throw createError("Unable to resolve actor identity", 401);
    }
    const isOwner = actorIds.includes(String(incident.reported_by || ""));
    if (!isOwner) {
      throw createError("You are not allowed to access incidents from other users", 403);
    }
  }

  const [photos, details] = await Promise.all([
    IncidentPhoto.find({ incident_id: incidentId }).select("photo_url -_id").lean(),
    IncidentDetail.find({ incident_id: incidentId })
      .select("type item_id service_catalog_id name_snapshot unit_cost_snapshot quantity total_cost note")
      .lean(),
  ]);

  return toIncidentView(
    incident,
    photos.map((item) => item.photo_url),
    details
  );
};

exports.createDamageReport = async (
  {
    cleaning_task_id,
    pod_id,
    booking_id,
    details,
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

  const normalizedDetailsPayload = parseIncidentDetailsPayload({
    details,
  });

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

  const pod = await Pod.findOne({ id: resolvedPodId }).select("id code name").lean();
  if (!pod) throw createError("Pod not found", 404);

  const serviceFeeInput = parseNonNegativeNumber(estimated_service_fee, "estimated_service_fee", null);

  const reporterId = resolveActorId(actor);
  if (!reporterId) throw createError("Unable to resolve reporter identity", 401);

  const [reporter, resolvedDetailsData] = await Promise.all([
    User.findOne({ $or: [{ id: reporterId }, { _id: reporterId }] })
      .select("id _id isActive name")
      .lean(),
    resolveIncidentDetails(normalizedDetailsPayload),
  ]);

  if (!reporter) throw createError("Reporter not found", 404);
  if (!reporter.isActive) throw createError("Reporter is inactive", 403);

  const estimatedItemValue = resolvedDetailsData.estimatedItemValue;
  const serviceFee = serviceFeeInput !== null ? serviceFeeInput : resolvedDetailsData.estimatedServiceValue;
  const estimatedTotalValue = estimatedItemValue + serviceFee;

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
            estimated_service_fee: serviceFee,
            estimated_total_value: estimatedTotalValue,
            pricing_source: "ITEM_SUMMARY_SNAPSHOT",
          },
        ],
        { session }
      );

      await IncidentDetail.insertMany(
        resolvedDetailsData.resolved.map((entry) => ({
          incident_id: createdIncident.id,
          type: entry.type,
          item_id: entry.item_id,
          service_catalog_id: entry.service_catalog_id,
          name_snapshot: entry.name_snapshot,
          unit_cost_snapshot: entry.unit_cost_snapshot,
          quantity: entry.quantity,
          total_cost: entry.total_cost,
          note: entry.note,
        })),
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

  const reporterRole = String(actor?.role || "").toLowerCase();
  if (reporterRole === "cleaner") {
    const podCode = pod?.code || pod?.name || resolvedPodId || "Unknown";
    const cleanerUserId = String(reporter._id || "");

    if (cleanerUserId) {
      await notificationService.sendToUser(cleanerUserId, {
        title: "Bao cao hu hai da duoc gui",
        message: `Bao cao hu hai tai Pod ${podCode} da duoc gui toi he thong.`,
        type: "INCIDENT",
        event_code: "INCIDENT_REPORTED",
        dedupe_key: `INCIDENT_REPORTED:${incident.id}:${cleanerUserId}`,
        data: {
          incident_id: incident.id,
          pod_id: resolvedPodId,
          pod_code: podCode,
          status: String(incident.status || "PENDING").toUpperCase(),
          incident_type: "DAMAGE_REPORT",
          estimated_total_value: incident.estimated_total_value,
        },
      });

      emitCleanerNotificationEvent({
        user_id: cleanerUserId,
        notification: {
          event: "INCIDENT_REPORTED",
          payload: {
            incident_id: incident.id,
            pod_id: resolvedPodId,
            pod_code: podCode,
            status: String(incident.status || "PENDING").toUpperCase(),
            incident_type: "DAMAGE_REPORT",
            estimated_total_value: incident.estimated_total_value,
            title: "Bao cao hu hai da duoc gui",
            message: `Bao cao hu hai tai Pod ${podCode} da duoc gui toi he thong.`,
          },
        },
      });
    }

    const managerUserIds = await resolveManagersForPod(resolvedPodId);
    await Promise.all(
      managerUserIds.map((managerUserId) =>
        notificationService.sendToUser(managerUserId, {
          title: "Co bao cao hu hai moi",
          message: `Cleaner vua gui bao cao hu hai cho Pod ${podCode}. Vui long kiem tra va duyet.`,
          type: "INCIDENT",
          event_code: "INCIDENT_REVIEW_REQUIRED",
          dedupe_key: `INCIDENT_REVIEW_REQUIRED:${incident.id}:${managerUserId}`,
          data: {
            incident_id: incident.id,
            pod_id: resolvedPodId,
            pod_code: podCode,
            status: String(incident.status || "PENDING").toUpperCase(),
            incident_type: "DAMAGE_REPORT",
            estimated_total_value: incident.estimated_total_value,
            reported_by: reporterId,
          },
        })
      )
    );
  }

  return toDamageReportView(
    incident,
    photoRecords.map((item) => item.url),
    {
      pod_name: pod.name || null,
      user_id: String(reporter.id || reporter._id || reporterId),
      user_name: reporter.name || null,
      cleaner_name: reporter.name || null,
    },
    resolvedDetailsData.resolved
  );
};

exports.updateIncidentStatus = async (incidentId, payload, actor = null) => {
  const { status, resolution_note, escalation_note } = payload;
  const normalizedStatus = normalizeStatus(status);

  if (!INCIDENT_STATUSES.includes(normalizedStatus)) {
    throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
  }

  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();

  if (actorRole === "cleaner") {
    throw createError("Cleaner is not allowed to update incident status", 403);
  }

  if (actorRole === "manager" && actor.managerScope) {
    if (!actor.managerScope.podIds.includes(String(incident.pod_id))) {
      throw createError("You are not allowed to update an incident out of your management scope", 403);
    }
  }

  const previousStatus = String(incident.status || "").toUpperCase();
  if (previousStatus !== normalizedStatus && previousStatus !== "PENDING") {
    throw createError("Only incidents in PENDING status can be reviewed", 400);
  }

  if (actorRole === "manager" && !["RESOLVED", "DISMISSED"].includes(normalizedStatus)) {
    throw createError("Manager can only set incident status to RESOLVED or DISMISSED", 400);
  }

  let damageBilling = {
    damage_total_value: 0,
    user_deposit_value: 0,
    deposit_deducted_value: 0,
    total_amount_value: 0,
    currency: "VND",
    booking_id: incident.booking_id || null,
    booking_order_id: null,
    refunded_to_wallet_amount: 0,
    refunded_transaction_id: null,
  };

  incident.status = normalizedStatus;
  if (resolution_note !== undefined) {
    incident.resolution_note = resolution_note;
  }
  if (escalation_note !== undefined) {
    incident.escalation_note = escalation_note;
  }
  incident.handled_by = ["RESOLVED", "DISMISSED"].includes(normalizedStatus)
    ? resolveActorId(actor)
    : incident.handled_by;

  const isManagerResolvedFlow = actorRole === "manager" && normalizedStatus === "RESOLVED";
  if (isManagerResolvedFlow && previousStatus !== normalizedStatus) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await incident.save({ session });

        const damageTotalValue = await getIncidentDamageTotal(incident);
        damageBilling.damage_total_value = damageTotalValue;

        if (!incident.booking_id) {
          damageBilling.total_amount_value = damageTotalValue;
          return;
        }

        const booking = await Booking.findOne({ id: incident.booking_id })
          .select("id order_id")
          .session(session)
          .lean();

        if (!booking || !booking.order_id) {
          damageBilling.total_amount_value = damageTotalValue;
          return;
        }

        const order = await BookingOrder.findOne({ id: booking.order_id }).session(session);
        if (!order) {
          damageBilling.total_amount_value = damageTotalValue;
          return;
        }

        damageBilling.booking_order_id = order.id;
        const userDepositValue = roundMoney(order.deposit_total || 0);
        const depositDeductedValue = roundMoney(Math.min(damageTotalValue, userDepositValue));
        const remainingDeposit = roundMoney(Math.max(0, userDepositValue - depositDeductedValue));
        const totalAmountValue = roundMoney(Math.max(0, damageTotalValue - userDepositValue));

        damageBilling.user_deposit_value = userDepositValue;
        damageBilling.deposit_deducted_value = depositDeductedValue;
        damageBilling.total_amount_value = totalAmountValue;

        if (userDepositValue > 0) {
          if (depositDeductedValue <= 0) {
            order.deposit_settlement_status = "REFUNDED";
          } else if (remainingDeposit > 0) {
            order.deposit_settlement_status = "PARTIALLY_FORFEITED";
          } else {
            order.deposit_settlement_status = "FORFEITED";
          }
        }

        if (remainingDeposit > 0) {
          const wallet = await getOrCreateWalletByUserId(order.user_id, session);
          const balanceBefore = roundMoney(wallet.balance || 0);
          const balanceAfter = roundMoney(balanceBefore + remainingDeposit);
          wallet.balance = balanceAfter;
          await wallet.save({ session });

          const refundTx = await Transaction.create(
            [
              {
                order_id: order.id,
                amount: remainingDeposit,
                currency: "VND",
                type: "REFUND",
                method: "WALLET",
                status: "SUCCESS",
                provider_reference: `INCIDENT_DEPOSIT_REFUND:${incident.id}`,
              },
            ],
            { session }
          );

          await WalletTransaction.create(
            [
              {
                wallet_id: wallet.id,
                amount: remainingDeposit,
                type: "REFUND",
                transaction_id: refundTx[0].id,
                reference_id: order.id,
                description: `Hoan coc con lai sau xu ly hu hai incident ${incident.id}`,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
              },
            ],
            { session }
          );

          damageBilling.refunded_to_wallet_amount = remainingDeposit;
          damageBilling.refunded_transaction_id = refundTx[0].id;
        }

        await order.save({ session });
      });
    } finally {
      session.endSession();
    }
  } else {
    await incident.save();
  }

  const isManagerReviewFlow = actorRole === "manager" && ["RESOLVED", "DISMISSED"].includes(normalizedStatus);
  if (isManagerReviewFlow && previousStatus !== normalizedStatus) {
    const reporter = await User.findOne({
      $or: [
        { id: String(incident.reported_by || "") },
        { _id: String(incident.reported_by || "") },
      ],
    })
      .select("_id role")
      .lean();

    if (reporter && String(reporter.role || "").toLowerCase() === "cleaner") {
      const pod = await Pod.findOne({ id: incident.pod_id }).select("id code").lean();
      const podCode = pod?.code || incident.pod_id || "Unknown";

      await notificationService.sendToUser(reporter._id, {
        title: normalizedStatus === "DISMISSED" ? "Bao cao da bi bac bo" : "Bao cao da duoc duyet",
        message:
          normalizedStatus === "DISMISSED"
            ? `Bao cao hu hai tai Pod ${podCode} da bi manager bac bo.`
            : `Bao cao hu hai tai Pod ${podCode} da duoc manager xac nhan va xu ly.`,
        type: "INCIDENT",
        event_code: normalizedStatus === "DISMISSED" ? "INCIDENT_DISMISSED" : "INCIDENT_RESOLVED",
        dedupe_key: `INCIDENT_REVIEWED:${incident.id}:${normalizedStatus}`,
        data: {
          incident_id: incident.id,
          pod_id: incident.pod_id,
          pod_code: podCode,
          status: normalizedStatus,
        },
      });
    }

    if (normalizedStatus === "RESOLVED" && damageBilling.booking_order_id) {
      const order = await BookingOrder.findOne({ id: damageBilling.booking_order_id })
        .select("user_id")
        .lean();

      if (order && order.user_id) {
        await notificationService.sendToUser(order.user_id, {
          title: "Xu ly hu hai va quyet toan tien coc",
          message:
            damageBilling.refunded_to_wallet_amount > 0
              ? `Da tru ${damageBilling.deposit_deducted_value.toLocaleString("vi-VN")} VND tu coc de bu hu hai va hoan ${damageBilling.refunded_to_wallet_amount.toLocaleString("vi-VN")} VND vao vi.`
              : `Da tru ${damageBilling.deposit_deducted_value.toLocaleString("vi-VN")} VND tu coc de bu hu hai.`,
          type: "INCIDENT",
          event_code: "PAYMENT_DEPOSIT_REFUND_SUCCESS",
          dedupe_key: `INCIDENT_DEPOSIT_SETTLEMENT:${incident.id}`,
          data: {
            type: "INCIDENT_DEPOSIT_SETTLEMENT",
            incident_id: incident.id,
            booking_id: damageBilling.booking_id,
            booking_order_id: damageBilling.booking_order_id,
            damage_total_value: String(damageBilling.damage_total_value),
            user_deposit_value: String(damageBilling.user_deposit_value),
            deposit_deducted_value: String(damageBilling.deposit_deducted_value),
            total_amount_value: String(damageBilling.total_amount_value),
            refunded_to_wallet_amount: String(damageBilling.refunded_to_wallet_amount),
            refunded_transaction_id: String(damageBilling.refunded_transaction_id || ""),
          },
        });
      }
    }
  }

  const incidentObj = typeof incident.toObject === "function" ? incident.toObject() : incident;
  return {
    ...incidentObj,
    total_amount_value: damageBilling.total_amount_value,
    damage_billing: damageBilling,
  };
};

