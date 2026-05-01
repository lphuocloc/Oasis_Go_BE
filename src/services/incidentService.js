const Incident = require("../models/Incidents");
const IncidentDetail = require("../models/IncidentDetail");
const IncidentMedia = require("../models/IncidentMedia");
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
const StaffWorkRoster = require("../models/StaffWorkRoster");
const User = require("../models/User");
const mongoose = require("mongoose");
const notificationService = require("./notificationService");
const debtService = require("./debtService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");
const LocationWarehouse = require("../models/LocationWarehouse");
const InventoryStock = require("../models/InventoryStock");
const InventoryActivityLog = require("../models/InventoryActivityLog");
const PodItem = require("../models/PodItem");

const INCIDENT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "RESOLVED", "DISMISSED"];
const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const INCIDENT_TYPES = ["OPERATIONAL", "DAMAGE_REPORT", "REPLENISHMENT_REQUEST"];
const INCIDENT_DETAIL_TYPES = ["ITEM", "SERVICE"];
const REFUND_BLOCKING_TASK_STATUSES = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "MISSED"];
const ORDER_BOOKING_TERMINAL_STATUSES = ["COMPLETED", "CANCELLED"];

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
  if (incident?.estimated_total_value !== null && incident?.estimated_total_value !== undefined) {
    const estimated = Number(incident.estimated_total_value);
    if (Number.isFinite(estimated) && estimated >= 0) {
      return roundMoney(estimated);
    }
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

  const rosters = await StaffWorkRoster.find({
    location_id: cluster.location_id,
    is_active: true
  }).lean();

  const rosterStaffIds = [...new Set(rosters.map(r => String(r.staff_id)))];

  if (!rosterStaffIds.length) {
    const allManagers = await User.find({ role: "manager", isActive: true })
      .select("_id")
      .lean();
    return [...new Set(allManagers.map((m) => String(m._id || "")).filter(Boolean))];
  }

  const assignmentObjectIds = rosterStaffIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const managers = await User.find({
    role: "manager",
    isActive: true,
    $or: [{ id: { $in: rosterStaffIds } }, { _id: { $in: assignmentObjectIds } }],
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

  const photos = await IncidentMedia.find({ incident_id: { $in: incidentIds } })
    .select("incident_id media_url")
    .lean();

  return photos.reduce((map, item) => {
    if (!map[item.incident_id]) map[item.incident_id] = [];
    map[item.incident_id].push(item.media_url);
    return map;
  }, {});
};

const buildIncidentDetailMap = async (incidentIds = [], session = null) => {
  if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
    return {};
  }

  let query = IncidentDetail.find({ incident_id: { $in: incidentIds } })
    .select("incident_id type item_id service_catalog_id name_snapshot unit_cost_snapshot quantity total_cost note")
    .lean();

  if (session) {
    query = query.session(session);
  }

  const details = await query;

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
      throw createError("Invalid incident_type. Must be one of: OPERATIONAL, DAMAGE_REPORT, REPLENISHMENT_REQUEST", 400);
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
    IncidentMedia.find({ incident_id: incidentId }).select("media_url file_type -_id").lean(),
    IncidentDetail.find({ incident_id: incidentId })
      .select("type item_id service_catalog_id name_snapshot unit_cost_snapshot quantity total_cost note")
      .lean(),
  ]);

  return toIncidentView(
    incident,
    photos.map((item) => item.media_url),
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
        file_type: item.file_type === "VIDEO" ? "VIDEO" : "IMAGE",
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
        await IncidentMedia.insertMany(
          photoRecords.map((item) => ({
            incident_id: createdIncident.id,
            media_url: item.url,
            media_public_id: item.public_id || null,
            file_type: item.file_type || "IMAGE",
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
        title: "Báo cáo hư hại đã được gửi",
        message: `Báo cáo hư hại tại Pod ${podCode} đã được gửi tới hệ thống.`,
        type: "INCIDENT",
        event_code: "INCIDENT_REPORTED",
        dedupe_key: `INCIDENT_REPORTED:${incident.id}:${cleanerUserId}`,
        data: {
          incident_id: incident.id,
          pod_id: resolvedPodId,
          pod_code: podCode,
          cleaning_task_id: taskContext ? taskContext.id : null,
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
            cleaning_task_id: taskContext ? taskContext.id : null,
            status: String(incident.status || "PENDING").toUpperCase(),
            incident_type: "DAMAGE_REPORT",
            estimated_total_value: incident.estimated_total_value,
            title: "Báo cáo hư hại đã được gửi",
            message: `Báo cáo hư hại tại Pod ${podCode} đã được gửi tới hệ thống.`,
          },
        },
      });
    }

    const managerUserIds = await resolveManagersForPod(resolvedPodId);
    await Promise.all(
      managerUserIds.map((managerUserId) =>
        notificationService.sendToUser(managerUserId, {
          title: "Có báo cáo hư hại mới",
          message: `Cleaner vừa gửi báo cáo hư hại cho Pod ${podCode}. Vui lòng kiểm tra và duyệt.`,
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
  const logPrefix = "[IncidentReview][SettlementGate]";

  console.info(`${logPrefix} Start`, {
    incident_id: String(incidentId || ""),
    requested_status: normalizedStatus || null,
    actor_role: String(actor?.role || "").toLowerCase() || null,
    actor_id: resolveActorId(actor),
  });

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
  console.info(`${logPrefix} CurrentStatus`, {
    incident_id: String(incident.id || incidentId || ""),
    previous_status: previousStatus,
    requested_status: normalizedStatus,
  });

  const MANAGER_REVIEWABLE_STATUSES = ["PENDING", "COMPLETED"];
  if (previousStatus !== normalizedStatus && !MANAGER_REVIEWABLE_STATUSES.includes(previousStatus)) {
    throw createError("Only incidents in PENDING or COMPLETED status can be reviewed", 400);
  }

  if (actorRole === "manager" && !["RESOLVED", "DISMISSED"].includes(normalizedStatus)) {
    throw createError("Manager can only set incident status to RESOLVED or DISMISSED", 400);
  }

  let damageBilling = {
    damage_total_value: 0,
    total_amount_value: 0,
    currency: "VND",
    booking_id: incident.booking_id || null,
    booking_order_id: null,
    settlement_applied: false,
    settlement_reason: null,
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

  await incident.save();

  if (normalizedStatus === "RESOLVED") {
    damageBilling.damage_total_value = await getIncidentDamageTotal(incident);
    damageBilling.total_amount_value = damageBilling.damage_total_value;
  }

  const isManagerReviewFlow = actorRole === "manager" && ["RESOLVED", "DISMISSED"].includes(normalizedStatus);
  console.info(`${logPrefix} SettlementGateDecision`, {
    incident_id: String(incident.id || incidentId || ""),
    actor_role: actorRole,
    previous_status: previousStatus,
    requested_status: normalizedStatus,
    is_manager_review_flow: isManagerReviewFlow,
    has_real_status_transition: previousStatus !== normalizedStatus,
  });

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
        title: normalizedStatus === "DISMISSED" ? "Báo cáo đã bị bác bỏ" : "Báo cáo đã được duyệt",
        message:
          normalizedStatus === "DISMISSED"
            ? `Báo cáo hư hại tại Pod ${podCode} đã bị manager bác bỏ.`
            : `Báo cáo hư hại tại Pod ${podCode} đã được manager xác nhận và xử lý.`,
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

    const booking = incident.booking_id
      ? await Booking.findOne({ id: incident.booking_id }).select("order_id").lean()
      : null;

    console.info(`${logPrefix} BookingResolved`, {
      incident_id: String(incident.id || incidentId || ""),
      booking_id: String(incident.booking_id || ""),
      booking_found: Boolean(booking),
      booking_order_id: booking?.order_id ? String(booking.order_id) : null,
    });

    if (booking?.order_id) {
      damageBilling.booking_order_id = booking.order_id;
    } else {
      console.warn(`${logPrefix} SkipSettlement`, {
        incident_id: String(incident.id || incidentId || ""),
        reason: "BOOKING_ORDER_NOT_FOUND",
        booking_id: String(incident.booking_id || ""),
      });
    }
  } else {
    console.info(`${logPrefix} SkipSettlement`, {
      incident_id: String(incident.id || incidentId || ""),
      reason: "GATE_NOT_PASSED",
      actor_role: actorRole,
      previous_status: previousStatus,
      requested_status: normalizedStatus,
    });

    const isSettlementTargetStatus = ["RESOLVED", "DISMISSED"].includes(normalizedStatus);
    const hasRealStatusTransition = previousStatus !== normalizedStatus;

    if (isSettlementTargetStatus && hasRealStatusTransition) {
      damageBilling.settlement_applied = false;

      if (!actorRole) {
        damageBilling.settlement_reason = "ACTOR_ROLE_MISSING";
      } else if (actorRole !== "manager") {
        damageBilling.settlement_reason = "ACTOR_ROLE_NOT_ELIGIBLE_FOR_SETTLEMENT";
      } else {
        damageBilling.settlement_reason = "SETTLEMENT_GATE_NOT_PASSED";
      }
    } else if (isSettlementTargetStatus && !hasRealStatusTransition) {
      damageBilling.settlement_applied = false;
      damageBilling.settlement_reason = "STATUS_NOT_CHANGED";
    }
  }

  const incidentObj = typeof incident.toObject === "function" ? incident.toObject() : incident;
  return {
    ...incidentObj,
    total_amount_value: damageBilling.total_amount_value,
    damage_billing: damageBilling,
  };
};

exports.getOrderIncidents = async (orderId) => {
  const bookings = await Booking.find({ order_id: orderId }).select("id").lean();
  if (!bookings.length) return [];
  const bookingIds = bookings.map(b => String(b.id));

  const incidents = await Incident.find({ booking_id: { $in: bookingIds } }).lean();

  const results = [];
  for (const inc of incidents) {
    const totalAmount = await getIncidentDamageTotal(inc);

    // Get item names from IncidentDetail
    const details = await IncidentDetail.find({ incident_id: inc.id }).select("name_snapshot").lean();
    const items = details.map(d => d.name_snapshot).filter(Boolean);

    results.push({
      ...inc,
      total_amount_value: totalAmount,
      items
    });
  }
  return results;
};

exports.createOrderDamageBill = async (orderId, managerActor) => {
  const bookings = await Booking.find({ order_id: orderId }).select("id user_id").lean();
  if (!bookings.length) throw createError("Order not found or has no bookings", 404);
  const userId = bookings[0].user_id;

  const bookingIds = bookings.map(b => String(b.id));
  const incidents = await Incident.find({ booking_id: { $in: bookingIds }, incident_type: "DAMAGE_REPORT" }).lean();

  if (!incidents.length) {
    throw createError("No damage incidents found for this order", 400);
  }

  // Validate all are RESOLVED or DISMISSED
  const unresolved = incidents.filter(i => !["RESOLVED", "DISMISSED"].includes(i.status));
  if (unresolved.length > 0) {
    throw createError("Tất cả báo cáo sự cố (Damage Report) trong Order này phải được xử lý (RESOLVED hoặc DISMISSED) trước khi tạo hóa đơn.", 400);
  }

  const resolvedIncidents = incidents.filter(i => i.status === "RESOLVED");
  if (resolvedIncidents.length === 0) {
    throw createError("Không có sự cố nào cần đền bù (tất cả đều đã bị DISMISSED hoặc không có thiệt hại).", 400);
  }

  let totalDamageAmount = 0;
  const incidentBreakdown = [];

  for (const inc of resolvedIncidents) {
    const amount = await getIncidentDamageTotal(inc);
    if (amount > 0) {
      totalDamageAmount += amount;
      const details = await IncidentDetail.find({ incident_id: inc.id }).select("name_snapshot").lean();
      const items = details.map(d => d.name_snapshot).filter(Boolean);
      incidentBreakdown.push({ incident_id: inc.id, amount, items });
    }
  }

  if (totalDamageAmount <= 0) {
    throw createError("Tổng thiệt hại bằng 0, không có hóa đơn nào được tạo.", 400);
  }

  const order = await BookingOrder.findOne({ id: orderId });
  if (!order) {
    throw createError("Không tìm thấy Order.", 404);
  }

  order.outstanding_damage_amount = totalDamageAmount;
  order.damage_payment_status = "PENDING";
  await order.save();

  // Notify user
  await notificationService.sendToUser(userId, {
    title: "Yêu cầu thanh toán phí đền bù hư hại",
    message: `Đơn hàng ${orderId} có phát sinh phí đền bù hư hại là ${totalDamageAmount.toLocaleString("vi-VN")} VND. Vui lòng thanh toán tại quầy.`,
    type: "INCIDENT",
    event_code: "DAMAGE_BILL_CREATED",
    dedupe_key: `DAMAGE_BILL_CREATED:ORDER:${orderId}`,
    data: {
      order_id: orderId,
      outstanding_damage_amount: String(totalDamageAmount),
    },
  });

  return {
    order_id: orderId,
    outstanding_damage_amount: totalDamageAmount,
    incident_breakdown: incidentBreakdown
  };
};

exports.resolveReplenishmentIncident = async (incidentId, cleanerId, itemsPayload) => {
  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  if (incident.incident_type !== "REPLENISHMENT_REQUEST") {
    throw createError("This incident is not a replenishment request", 400);
  }
  if (!["PENDING", "ASSIGNED", "PROCESSING"].includes(incident.status)) {
    throw createError("Incident is already resolved or dismissed", 400);
  }

  // Identify Cleaner
  const user = await User.findOne(
    mongoose.Types.ObjectId.isValid(cleanerId)
      ? { $or: [{ id: cleanerId }, { _id: cleanerId }] }
      : { id: cleanerId }
  ).select("_id id name").lean();

  if (!user) throw createError("Cleaner not found", 404);

  // Identify location based on pod
  const pod = await Pod.findOne({ id: incident.pod_id }).select("cluster_id").lean();
  if (!pod) throw createError("Pod not found", 404);

  const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("location_id").lean();
  if (!cluster || !cluster.location_id) throw createError("Location not found for this pod", 404);

  const locationWarehouse = await LocationWarehouse.findOne({ location_id: cluster.location_id }).lean();
  if (!locationWarehouse || !locationWarehouse.warehouse_id) {
    throw createError("No warehouse configured for this location", 400);
  }

  const warehouseId = locationWarehouse.warehouse_id;

  if (!Array.isArray(itemsPayload) || itemsPayload.length === 0) {
    throw createError("items payload is required and must be an array", 400);
  }

  const itemQuantities = new Map();
  for (const item of itemsPayload) {
    const qty = parseInt(item.quantity, 10);
    if (isNaN(qty) || qty <= 0) throw createError(`Invalid quantity for item ${item.item_id}`, 400);
    const existing = itemQuantities.get(item.item_id) || 0;
    itemQuantities.set(item.item_id, existing + qty);
  }

  const itemIds = Array.from(itemQuantities.keys());
  const stocks = await InventoryStock.find({ warehouse_id: warehouseId, item_id: { $in: itemIds } });
  const stockMap = new Map(stocks.map(s => [s.item_id, s]));

  for (const [itemId, qty] of itemQuantities.entries()) {
    const stock = stockMap.get(itemId);
    if (!stock || stock.quantity_available < qty) {
      throw createError(`Not enough stock in warehouse for item ${itemId}`, 400);
    }
  }

  // Deduct stock and log
  for (const [itemId, qty] of itemQuantities.entries()) {
    const stock = stockMap.get(itemId);
    stock.quantity_available -= qty;
    await stock.save();

    await InventoryActivityLog.create({
      inventory_stock_id: stock.id,
      staff_id: user.id || String(user._id),
      actor_id: user.id || String(user._id),
      incident_id: incident.id,
      quantity: qty,
      action_type: "CONSUMED",
      reason: "Bổ sung vật dụng thiếu/hỏng lúc checkin"
    });

    const podItem = await PodItem.findOne({ pod_id: incident.pod_id, item_id: itemId });
    if (podItem) {
      podItem.current_quantity = Math.min(podItem.current_quantity + qty, podItem.expected_quantity);
      await podItem.save();
    }
  }

  incident.status = "RESOLVED";
  incident.handled_by = user.id || String(user._id);
  incident.resolution_note = "Đã bổ sung vật dụng từ kho";
  await incident.save();

  return {
    message: "Việc bổ sung hàng đã được giải quyết thành công.",
    incident_id: incident.id,
    warehouse_id: warehouseId,
    items_processed: itemQuantities.size
  };
};

// ─── Cleaner Incident APIs ────────────────────────────────────────

exports.getCleanerIncidents = async (actor, filters = {}) => {
  const actorIds = resolveActorIdentityIds(actor);
  if (actorIds.length === 0) throw createError("Unable to resolve actor identity", 401);

  // Condition 1: incidents reported by this cleaner
  const ownIncidents = await Incident.find({ reported_by: { $in: actorIds } }).lean();

  // Condition 2: incidents linked to a cleaning task assigned to this cleaner
  const cleanerTasks = await CleaningTask.find({ cleaner_id: { $in: actorIds } })
    .select("id")
    .lean();
  const cleanerTaskIds = cleanerTasks.map((t) => String(t.id));

  let taskIncidents = [];
  if (cleanerTaskIds.length > 0) {
    taskIncidents = await Incident.find({ cleaning_task_id: { $in: cleanerTaskIds } }).lean();
  }

  // Merge and dedupe
  const incidentMap = new Map();
  [...ownIncidents, ...taskIncidents].forEach((inc) => {
    incidentMap.set(String(inc.id), inc);
  });

  let incidents = Array.from(incidentMap.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  // Optional filters
  if (filters.status) {
    const status = normalizeStatus(filters.status);
    if (!INCIDENT_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${INCIDENT_STATUSES.join(", ")}`, 400);
    }
    incidents = incidents.filter((inc) => String(inc.status || "").toUpperCase() === status);
  }
  if (filters.incident_type) {
    const incidentType = normalizeIncidentType(filters.incident_type);
    if (!INCIDENT_TYPES.includes(incidentType)) {
      throw createError(
        `Invalid incident_type. Must be one of: ${INCIDENT_TYPES.join(", ")}`,
        400
      );
    }
    incidents = incidents.filter(
      (inc) => String(inc.incident_type || "").toUpperCase() === incidentType
    );
  }

  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((i) => i.id);

  // Build photo and detail maps
  const [photoMap, detailMap] = await Promise.all([
    buildIncidentPhotoMap(incidentIds),
    buildIncidentDetailMap(incidentIds),
  ]);

  // Batch-load cleaning tasks and bookings
  const cleaningTaskIdSet = new Set(
    incidents.map((i) => i.cleaning_task_id).filter(Boolean).map(String)
  );
  const bookingIdSet = new Set(
    incidents.map((i) => i.booking_id).filter(Boolean).map(String)
  );

  const [tasks, bookings] = await Promise.all([
    cleaningTaskIdSet.size > 0
      ? CleaningTask.find({ id: { $in: Array.from(cleaningTaskIdSet) } })
          .select(
            "id pod_id booking_id cleaner_id status assigned_at accepted_at started_at completed_at due_at request_source"
          )
          .lean()
      : Promise.resolve([]),
    bookingIdSet.size > 0
      ? Booking.find({ id: { $in: Array.from(bookingIdSet) } })
          .select(
            "id order_id user_id pod_id start_time end_time actual_end_time status checked_in_at checkin_state"
          )
          .lean()
      : Promise.resolve([]),
  ]);

  const taskById = new Map(tasks.map((t) => [String(t.id), t]));
  const bookingById = new Map(bookings.map((b) => [String(b.id), b]));

  // Batch-load users (reporter + handler) and pods
  const userIdSet = new Set();
  const podIdSet = new Set();
  incidents.forEach((inc) => {
    if (inc.reported_by) userIdSet.add(String(inc.reported_by));
    if (inc.handled_by) userIdSet.add(String(inc.handled_by));
    if (inc.pod_id) podIdSet.add(String(inc.pod_id));
  });

  const [users, pods] = await Promise.all([
    userIdSet.size > 0
      ? User.find({ $or: [{ id: { $in: Array.from(userIdSet) } }, { _id: { $in: Array.from(userIdSet) } }] })
          .select("id _id name")
          .lean()
      : Promise.resolve([]),
    podIdSet.size > 0
      ? Pod.find({ id: { $in: Array.from(podIdSet) } })
          .select("id name")
          .lean()
      : Promise.resolve([]),
  ]);

  const userById = new Map();
  users.forEach((u) => {
    if (u.id) userById.set(String(u.id), u);
    if (u._id) userById.set(String(u._id), u);
  });
  const podById = new Map(pods.map((p) => [String(p.id), p]));

  return incidents.map((inc) => {
    const reporter = inc.reported_by ? userById.get(String(inc.reported_by)) : null;
    const handler = inc.handled_by ? userById.get(String(inc.handled_by)) : null;
    const pod = inc.pod_id ? podById.get(String(inc.pod_id)) : null;
    return {
      ...inc,
      photo_urls: photoMap[inc.id] || [],
      details: detailMap[inc.id] || [],
      cleaning_task: inc.cleaning_task_id ? taskById.get(String(inc.cleaning_task_id)) || null : null,
      booking: inc.booking_id ? bookingById.get(String(inc.booking_id)) || null : null,
      reporter_name: reporter?.name || null,
      handled_by_name: handler?.name || null,
      pod_name: pod?.name || null,
    };
  });
};

/**
 * Validate that the logged-in cleaner has access to a given incident.
 * Access is granted when:
 *  - The incident.reported_by matches the cleaner (CHECKOUT_REPORT), OR
 *  - The incident is a CHECKIN_REPORT whose booking_id links to a
 *    CleaningTask assigned to this cleaner.
 * Returns the associated CleaningTask if found.
 */
const _resolveCleanerAccessToIncident = async (incident, actorIds) => {
  // Own incident (DAMAGE_REPORT reported by cleaner during checkout)
  if (actorIds.includes(String(incident.reported_by || ""))) {
    const task = incident.cleaning_task_id
      ? await CleaningTask.findOne({ id: incident.cleaning_task_id })
        .select("id pod_id booking_id cleaner_id status assigned_at accepted_at started_at completed_at due_at request_source")
        .lean()
      : null;
    return { allowed: true, cleaningTask: task };
  }

  // Guest reports (REPLENISHMENT_REQUEST) during current cleaning session
  if (incident.incident_type === "REPLENISHMENT_REQUEST" && incident.booking_id) {
    const task = await CleaningTask.findOne({
      booking_id: incident.booking_id,
      cleaner_id: { $in: actorIds },
    })
      .select("id pod_id booking_id cleaner_id status assigned_at accepted_at started_at completed_at due_at request_source")
      .lean();

    if (task) {
      return { allowed: true, cleaningTask: task };
    }
  }

  return { allowed: false, cleaningTask: null };
};

/**
 * API 1 (Cleaner): Get incident detail enriched with booking and cleaning task info.
 */
exports.getCleanerIncidentDetail = async (incidentId, actor) => {
  const incident = await Incident.findOne({ id: incidentId }).lean();
  if (!incident) throw createError("Incident not found", 404);

  const actorIds = resolveActorIdentityIds(actor);
  if (actorIds.length === 0) throw createError("Unable to resolve actor identity", 401);

  const { allowed, cleaningTask } = await _resolveCleanerAccessToIncident(incident, actorIds);
  if (!allowed) {
    throw createError("You are not allowed to access this incident", 403);
  }

  const userIdSet = new Set();
  if (incident.reported_by) userIdSet.add(String(incident.reported_by));
  if (incident.handled_by) userIdSet.add(String(incident.handled_by));

  const [photos, details, booking, users, pod] = await Promise.all([
    IncidentMedia.find({ incident_id: incidentId }).select("media_url file_type -_id").lean(),
    IncidentDetail.find({ incident_id: incidentId })
      .select("type item_id service_catalog_id name_snapshot unit_cost_snapshot quantity total_cost note")
      .lean(),
    incident.booking_id
      ? Booking.findOne({ id: incident.booking_id })
        .select("id order_id user_id pod_id start_time end_time actual_end_time status checked_in_at checkin_state")
        .lean()
      : null,
    userIdSet.size > 0
      ? User.find({ $or: [{ id: { $in: Array.from(userIdSet) } }, { _id: { $in: Array.from(userIdSet) } }] })
          .select("id _id name")
          .lean()
      : Promise.resolve([]),
    incident.pod_id
      ? Pod.findOne({ id: incident.pod_id }).select("id name").lean()
      : null,
  ]);

  const userById = new Map();
  users.forEach((u) => {
    if (u.id) userById.set(String(u.id), u);
    if (u._id) userById.set(String(u._id), u);
  });

  const reporter = incident.reported_by ? userById.get(String(incident.reported_by)) : null;
  const handler = incident.handled_by ? userById.get(String(incident.handled_by)) : null;

  return {
    ...incident,
    photo_urls: photos.map((p) => p.media_url),
    details,
    booking: booking || null,
    cleaning_task: cleaningTask || null,
    reporter_name: reporter?.name || null,
    handled_by_name: handler?.name || null,
    pod_name: pod?.name || null,
  };
};

/**
 * API 2 (Cleaner): Get all REPLENISHMENT_REQUEST incidents for a cleaning task assigned to the cleaner.
 */
exports.getReplenishmentRequestsByCleaner = async (cleaningTaskId, actor) => {
  if (!cleaningTaskId) throw createError("cleaning_task_id is required", 400);

  const actorIds = resolveActorIdentityIds(actor);
  if (actorIds.length === 0) throw createError("Unable to resolve actor identity", 401);

  const cleaningTask = await CleaningTask.findOne({ id: cleaningTaskId })
    .select("id pod_id booking_id cleaner_id status assigned_at accepted_at started_at completed_at due_at request_source")
    .lean();

  if (!cleaningTask) throw createError("Cleaning task not found", 404);

  const taskCleanerId = String(cleaningTask.cleaner_id || "");
  if (!actorIds.includes(taskCleanerId)) {
    throw createError("This cleaning task is not assigned to you", 403);
  }

  const booking = cleaningTask.booking_id
    ? await Booking.findOne({ id: cleaningTask.booking_id })
      .select("id order_id user_id pod_id start_time end_time actual_end_time status checked_in_at checkin_state")
      .lean()
    : null;

  if (!cleaningTask.booking_id) {
    return { cleaning_task: cleaningTask, booking: null, incidents: [] };
  }

  const incidents = await Incident.find({
    booking_id: cleaningTask.booking_id,
    incident_type: "REPLENISHMENT_REQUEST",
  })
    .sort({ created_at: -1 })
    .lean();

  if (!incidents.length) {
    return { cleaning_task: cleaningTask, booking: booking || null, incidents: [] };
  }

  const incidentIds = incidents.map((i) => i.id);
  const [photoMap, detailMap] = await Promise.all([
    buildIncidentPhotoMap(incidentIds),
    buildIncidentDetailMap(incidentIds),
  ]);

  const enrichedIncidents = incidents.map((inc) => ({
    ...inc,
    photo_urls: photoMap[inc.id] || [],
    details: detailMap[inc.id] || [],
  }));

  return {
    cleaning_task: cleaningTask,
    booking: booking || null,
    incidents: enrichedIncidents,
  };
};

/**
 * API 3 (Cleaner): Update incident status along the cleaner workflow.
 * Allowed transitions: PENDING → PROCESSING, PROCESSING → COMPLETED.
 */
exports.updateCleanerIncidentStatus = async (incidentId, payload, actor) => {
  const { status, resolution_note } = payload;
  const normalizedStatus = normalizeStatus(status);

  const ALLOWED_TARGET_STATUSES = ["PROCESSING", "COMPLETED"];
  if (!ALLOWED_TARGET_STATUSES.includes(normalizedStatus)) {
    throw createError(
      "Cleaner can only set incident status to PROCESSING or COMPLETED",
      400
    );
  }

  const incident = await Incident.findOne({ id: incidentId });
  if (!incident) throw createError("Incident not found", 404);

  const actorIds = resolveActorIdentityIds(actor);
  if (actorIds.length === 0) throw createError("Unable to resolve actor identity", 401);

  const { allowed } = await _resolveCleanerAccessToIncident(incident.toObject(), actorIds);
  if (!allowed) {
    throw createError("You are not allowed to update this incident", 403);
  }

  const previousStatus = String(incident.status || "").toUpperCase();

  const VALID_TRANSITIONS = {
    PENDING: "PROCESSING",
    PROCESSING: "COMPLETED",
  };

  if (VALID_TRANSITIONS[previousStatus] !== normalizedStatus) {
    throw createError(
      `Invalid status transition: ${previousStatus} → ${normalizedStatus}. Allowed: PENDING → PROCESSING, PROCESSING → COMPLETED`,
      400
    );
  }

  incident.status = normalizedStatus;
  if (resolution_note !== undefined) {
    incident.resolution_note = resolution_note;
  }
  if (normalizedStatus === "COMPLETED") {
    incident.handled_by = resolveActorId(actor);
  }

  await incident.save();

  return {
    id: incident.id,
    status: incident.status,
    previous_status: previousStatus,
    resolution_note: incident.resolution_note || null,
    handled_by: incident.handled_by || null,
    updated_at: incident.updated_at,
  };
};
