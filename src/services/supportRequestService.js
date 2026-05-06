const Booking = require("../models/Bookings");
const BookingSlot = require("../models/BookingSlot");
const CleaningBufferPolicy = require("../models/CleaningBufferPolicy");
const CleaningTask = require("../models/CleaningTask");
const Location = require("../models/Location");
const OnlineKey = require("../models/OnlineKey");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const PodQrCode = require("../models/PodQrCode");
const SupportRequest = require("../models/SupportRequest");
const TimeSlot = require("../models/TimeSlot");
const User = require("../models/User");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const mongoose = require("mongoose");
const notificationService = require("./notificationService");
const cleaningTaskService = require("./cleaningTaskService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");
const { getSocketServer } = require("../socket/socketServer");

const SUPPORT_TYPES = ["MAINTENANCE", "CHANGE_POD"];
const SUPPORT_STATUSES = ["PENDING", "PROCESSING", "IN_PROGRESS", "ESCALATED", "RESOLVED", "REJECTED", "CANCELED", "EXPIRED"];
const ACTIVE_SUPPORT_STATUSES = ["PENDING", "PROCESSING", "IN_PROGRESS"];
const MAINTENANCE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const DEFAULT_CLEANING_BUFFER_MINUTES = 30;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeUpper = (value) => String(value || "").trim().toUpperCase();

const normalizeSupportStatus = (status) => normalizeUpper(status);

const buildUserIdentityQuery = (identity) => {
  const normalizedIdentity = String(identity || "").trim();
  if (!normalizedIdentity) return null;

  const orQuery = [{ id: normalizedIdentity }];
  if (mongoose.Types.ObjectId.isValid(normalizedIdentity)) {
    orQuery.push({ _id: new mongoose.Types.ObjectId(normalizedIdentity) });
  }

  return { $or: orQuery };
};

const notifyCleanerOldPodNeedsCleaningAfterRoomChange = async ({
  task,
  oldPod,
  newPod,
  supportRequest,
}) => {
  if (!task || !task.cleaner_id || !oldPod) return;

  const cleanerQuery = buildUserIdentityQuery(task.cleaner_id);
  if (!cleanerQuery) return;

  const cleanerUser = await User.findOne(cleanerQuery).select("_id").lean();
  if (!cleanerUser || !cleanerUser._id) return;

  const cleanerUserId = String(cleanerUser._id);
  const oldPodCode = oldPod.code || oldPod.id || "Unknown";
  const newPodCode = newPod?.code || newPod?.id || "Unknown";

  const title = `Can don pod cu: ${oldPodCode}`;
  const message = `Khach da doi sang pod ${newPodCode}. Vui long don pod cu ${oldPodCode} ngay.`;

  await notificationService.sendToUser(cleanerUserId, {
    title,
    message,
    type: "CLEANING",
    event_code: "CLEANING_TASK_ASSIGNED",
    dedupe_key: `CLEANING_TASK_ASSIGNED:${String(task.id)}:${cleanerUserId}:ROOM_CHANGE_VACATED`,
    data: {
      cleaning_task_id: String(task.id),
      support_request_id: supportRequest?.id ? String(supportRequest.id) : null,
      booking_id: supportRequest?.booking_id ? String(supportRequest.booking_id) : null,
      pod_id: String(oldPod.id || ""),
      pod_code: oldPodCode,
      moved_to_pod_id: newPod?.id ? String(newPod.id) : null,
      moved_to_pod_code: newPodCode,
      request_source: "ROOM_CHANGE_VACATED",
      reason: "ROOM_CHANGE_VACATED",
    },
  });

  emitCleanerNotificationEvent({
    user_id: cleanerUserId,
    notification: {
      event: "CLEANING_TASK_ASSIGNED",
      payload: {
        cleaning_task_id: String(task.id),
        support_request_id: supportRequest?.id ? String(supportRequest.id) : null,
        booking_id: supportRequest?.booking_id ? String(supportRequest.booking_id) : null,
        pod_id: String(oldPod.id || ""),
        pod_code: oldPodCode,
        moved_to_pod_id: newPod?.id ? String(newPod.id) : null,
        moved_to_pod_code: newPodCode,
        request_source: "ROOM_CHANGE_VACATED",
        title,
        message,
      },
    },
  });
};

class SupportRequestService {
  _getActorId(actor) {
    return String(actor?._id || actor?.id || "");
  }

  _getActorRole(actor) {
    return String(actor?.role || "").toLowerCase();
  }

  async _resolveTopParentLocationId(locationId) {
    let currentLocationId = String(locationId || "");
    if (!currentLocationId) return null;

    let current = await Location.findOne({ id: currentLocationId }).select("id parent_id").lean();
    if (!current) return null;

    const visited = new Set([currentLocationId]);

    while (current.parent_id) {
      if (visited.has(String(current.parent_id))) {
        break;
      }
      visited.add(String(current.parent_id));

      const parent = await Location.findOne({ id: current.parent_id }).select("id parent_id").lean();
      if (!parent) break;
      current = parent;
    }

    return current?.id ? String(current.id) : null;
  }

  async _resolveLocationScopeFromParent(parentLocationId) {
    const rootId = String(parentLocationId || "");
    if (!rootId) return [];

    const descendants = await Location.getDescendants(rootId);
    const descendantIds = descendants.map((item) => String(item.id));
    return [rootId, ...descendantIds];
  }

  async _resolveCleaningBufferMinutes({ podId, clusterId, locationId }) {
    const podPolicy = podId
      ? await CleaningBufferPolicy.findOne({ pod_id: String(podId), is_active: true })
        .sort({ created_at: -1 })
        .select("buffer_minutes")
        .lean()
      : null;

    if (podPolicy && Number.isInteger(Number(podPolicy.buffer_minutes))) {
      return Number(podPolicy.buffer_minutes);
    }

    const clusterPolicy = clusterId
      ? await CleaningBufferPolicy.findOne({ cluster_id: String(clusterId), is_active: true })
        .sort({ created_at: -1 })
        .select("buffer_minutes")
        .lean()
      : null;

    if (clusterPolicy && Number.isInteger(Number(clusterPolicy.buffer_minutes))) {
      return Number(clusterPolicy.buffer_minutes);
    }

    const locationPolicy = locationId
      ? await CleaningBufferPolicy.findOne({ location_id: String(locationId), is_active: true })
        .sort({ created_at: -1 })
        .select("buffer_minutes")
        .lean()
      : null;

    if (locationPolicy && Number.isInteger(Number(locationPolicy.buffer_minutes))) {
      return Number(locationPolicy.buffer_minutes);
    }

    return DEFAULT_CLEANING_BUFFER_MINUTES;
  }

  async _ensureSupportRequestContext(supportRequest) {
    if (!supportRequest.location_id || !supportRequest.pod_id) {
      const booking = await Booking.findOne({ id: supportRequest.booking_id }).select("id pod_id");
      if (!booking) {
        throw createError("Booking not found for support request", 404);
      }

      const pod = await Pod.findOne({ id: booking.pod_id }).select("id cluster_id");
      if (!pod) {
        throw createError("Pod not found for support request booking", 404);
      }

      const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id");
      if (!cluster) {
        throw createError("Pod cluster not found for support request booking", 404);
      }

      supportRequest.pod_id = booking.pod_id;
      supportRequest.location_id = cluster.location_id;
    }

    return supportRequest;
  }

  async _assertManagerScopeAccess(supportRequest, managerScope) {
    const scopedLocationIds = new Set(((managerScope && managerScope.locationIds) || []).map((item) => String(item)));
    const scopedParentLocationIds = new Set(
      ((managerScope && managerScope.parentLocationIds) || []).map((item) => String(item))
    );

    if (!scopedLocationIds.has(String(supportRequest.location_id))) {
      throw createError("You are not allowed to handle support requests outside your location scope", 403);
    }

    if (scopedParentLocationIds.size > 0) {
      const topParentId = await this._resolveTopParentLocationId(supportRequest.location_id);
      
      const managerRoots = await Promise.all(
        Array.from(scopedParentLocationIds).map(id => this._resolveTopParentLocationId(id))
      );
      const managerRootSet = new Set(managerRoots.filter(Boolean).map(id => String(id)));

      if (topParentId && !managerRootSet.has(String(topParentId))) {
        throw createError("You are not allowed to handle support requests outside your parent location scope", 403);
      }
    }
  }

  async _getRoomChangeCandidates(booking, currentPod, currentCluster, managerScope) {
    const now = new Date();
    const remainingStart = now;

    const sameParentId = await this._resolveTopParentLocationId(currentCluster.location_id);
    const allowedLocationIds = sameParentId
      ? await this._resolveLocationScopeFromParent(sameParentId)
      : [String(currentCluster.location_id)];

    const relatedClusters = await PodCluster.find({
      location_id: { $in: allowedLocationIds.map((item) => String(item)) },
    })
      .select("id name location_id")
      .lean();

    const sameClusterIds = new Set([String(currentCluster.id)]);
    const sameParentClusterIds = new Set(relatedClusters.map((item) => String(item.id)));
    const candidateClusterIds = [...new Set([...sameClusterIds, ...sameParentClusterIds])];

    const scopedPodIds = new Set(((managerScope && managerScope.podIds) || []).map((item) => String(item)));
    const podQuery = {
      cluster_id: { $in: candidateClusterIds },
    };

    const rawPods = await Pod.find(podQuery).select("id code name cluster_id status type").lean();
    const pods = scopedPodIds.size > 0
      ? rawPods.filter((item) => scopedPodIds.has(String(item.id)))
      : rawPods;

    if (pods.length === 0) {
      return [];
    }

    const clusterById = new Map(relatedClusters.map((item) => [String(item.id), item]));
    clusterById.set(String(currentCluster.id), {
      id: String(currentCluster.id),
      name: currentCluster.name,
      location_id: String(currentCluster.location_id),
    });

    const candidates = [];

    // Process all pods concurrently to avoid N+1 query stalling
    const podPromises = pods.map(async (pod) => {
      const podCluster = clusterById.get(String(pod.cluster_id));
      if (!podCluster) return null;

      const bufferMinutes = await this._resolveCleaningBufferMinutes({
        podId: pod.id,
        clusterId: pod.cluster_id,
        locationId: podCluster.location_id,
      });

      const bufferedEnd = new Date(new Date(booking.end_time).getTime() + bufferMinutes * 60 * 1000);
      let isSelectable = true;

      if (pod.status !== "AVAILABLE" || String(pod.id) === String(currentPod.id)) {
        isSelectable = false;
      }

      if (isSelectable && remainingStart >= bufferedEnd) {
        isSelectable = false; // Time exhausted
      }

      if (isSelectable) {
        const isBookingAvailable = await Booking.isPodAvailable(
          pod.id,
          remainingStart,
          bufferedEnd,
          booking.id
        );
        if (!isBookingAvailable) {
          isSelectable = false;
        }
      }

      if (isSelectable) {
        const conflictingTimeSlot = await TimeSlot.findOne({
          pod_id: pod.id,
          status: "RESERVED",
          start_time: { $lt: bufferedEnd },
          end_time: { $gt: remainingStart },
        })
          .select("id")
          .lean();

        if (conflictingTimeSlot) {
          isSelectable = false;
        }
      }

      return {
        pod_id: pod.id,
        pod_code: pod.code,
        pod_name: pod.name,
        cluster_id: String(pod.cluster_id),
        cluster_name: podCluster.name || "Khác",
        location_id: String(podCluster.location_id),
        scope_level: String(pod.cluster_id) === String(currentCluster.id) ? "SAME_CLUSTER" : "SAME_PARENT_LOCATION",
        type: pod.type || "STANDARD",
        buffer_minutes_applied: bufferMinutes,
        remaining_time_start: remainingStart,
        remaining_time_end_with_buffer: bufferedEnd,
        is_selectable: isSelectable,
        status: pod.status
      };
    });

    const results = await Promise.all(podPromises);
    for (const res of results) {
      if (res) candidates.push(res);
    }

    candidates.sort((a, b) => {
      if (a.scope_level === b.scope_level) return 0;
      return a.scope_level === "SAME_CLUSTER" ? -1 : 1;
    });

    const standardCandidates = candidates.filter(c => c.type === "STANDARD");
    return standardCandidates.length > 0 ? standardCandidates : candidates;
  }

  async _notifyAdminsForEscalation(supportRequest, booking) {
    const admins = await User.find({ role: "admin", isActive: true }).select("_id").lean();
    if (!admins || admins.length === 0) {
      return;
    }

    await Promise.all(
      admins.map((admin) =>
        notificationService.sendToUser(admin._id, {
          title: "Yêu cầu hỗ trợ khẩn cấp",
          message: `Quản lý đã chuyển cấp một yêu cầu bảo trì mức độ ưu tiên ${supportRequest.severity || 'cao'}.`,
          type: "SUPPORT",
          event_code: "SUPPORT_ESCALATED",
          dedupe_key: `SUPPORT_ESCALATED:${supportRequest.id}:${admin._id}`,
          data: {
            support_request_id: supportRequest.id,
            booking_id: booking ? booking.id : supportRequest.booking_id,
            severity: supportRequest.severity || "UNKNOWN",
            status: supportRequest.status,
          },
        })
      )
    );
  }

  async _notifyCleanersForCleaningSupport(supportRequest, booking) {
    if (!supportRequest || normalizeUpper(supportRequest.type) !== "CLEANING") {
      return;
    }

    const clusterId = booking.pod_id ? await Pod.findOne({ id: booking.pod_id }).select("cluster_id").lean().then(pod => pod?.cluster_id) : null;
    if (!clusterId) return;

    const rosters = await StaffWorkRoster.find({
      cluster_id: clusterId,
      is_active: true
    }).select("staff_id").lean();

    if (!rosters || rosters.length === 0) {
      return;
    }

    const staffIds = [...new Set(rosters.map((item) => String(item.staff_id || "")).filter(Boolean))];
    if (staffIds.length === 0) {
      return;
    }

    const staffObjectIds = staffIds
      .filter((id) => /^[a-f\d]{24}$/i.test(id))
      .map((id) => id);

    const cleaners = await User.find({
      isActive: true,
      role: "cleaner",
      $or: [
        { id: { $in: staffIds } },
        { _id: { $in: staffObjectIds } },
      ],
    })
      .select("_id id")
      .lean();

    if (!cleaners || cleaners.length === 0) {
      return;
    }

    const pod = await Pod.findOne({ id: booking.pod_id }).select("id code").lean();
    const podCode = pod?.code || booking.pod_id || "Unknown";
    const description = String(supportRequest.description || "").trim() || "(khong co mo ta)";

    await Promise.all(
      cleaners.map((cleaner) => {
        const cleanerId = cleaner.id || cleaner._id;
        return notificationService.sendToUser(cleanerId, {
          title: `Yêu cầu vệ sinh đột xuất - Pod ${podCode}`,
          message: `Khách hàng tại Pod ${podCode} yêu cầu vệ sinh đột xuất. Lý do: ${description}`,
          type: "SUPPORT",
          event_code: "SUPPORT_CLEANING_REQUEST",
          dedupe_key: `SUPPORT_CLEANING_REQUEST:${supportRequest.id}:${String(cleanerId)}`,
          data: {
            support_request_id: supportRequest.id,
            booking_id: booking.id,
            pod_id: booking.pod_id,
            pod_code: podCode,
            description,
          },
        });
      })
    );

    cleaners.forEach((cleaner) => {
      const cleanerId = String(cleaner._id || cleaner.id || "");
      if (!cleanerId) return;

      emitCleanerNotificationEvent({
        user_id: cleanerId,
        notification: {
          event: "SUPPORT_CLEANING_REQUEST",
          payload: {
            support_request_id: supportRequest.id,
            booking_id: booking.id,
            pod_id: booking.pod_id,
            pod_code: podCode,
            description,
            title: `Yêu cầu vệ sinh đột xuất - Pod ${podCode}`,
            message: `Khách hàng tại Pod ${podCode} yêu cầu vệ sinh đột xuất. Lý do: ${description}`,
          },
        },
      });
    });
  }

  async _notifyManagersForSupportRequest(supportRequest, podCode) {
    if (!supportRequest || !supportRequest.location_id) return;

    let managerUserIds = [];

    try {
      const rosters = await StaffWorkRoster.find({
        location_id: String(supportRequest.location_id),
        is_active: true
      }).select("staff_id").lean();

      if (rosters.length > 0) {
        const assignmentStaffIds = [...new Set(rosters.map((entry) => String(entry.staff_id || "")).filter(Boolean))];

        if (assignmentStaffIds.length > 0) {
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

          managerUserIds = [...new Set(managers.map((manager) => String(manager._id || "")).filter(Boolean))];
        }
      }
    } catch (err) {
      console.error("Error finding manager by shifts:", err);
    }

    // Fallback if no specific manager on duty is found
    if (!managerUserIds || managerUserIds.length === 0) {
      const allManagers = await User.find({ role: "manager", isActive: true }).select("_id").lean();
      managerUserIds = [...new Set(allManagers.map((manager) => String(manager._id || "")).filter(Boolean))];
    }

    if (!managerUserIds.length) return; // Still no managers found in system

    const typeLabel = normalizeUpper(supportRequest.type) === "CLEANING" ? "vệ sinh" : "hỗ trợ";
    const titleLabel = normalizeUpper(supportRequest.type) === "CLEANING" ? "Yêu Cầu Vệ Sinh" : "Yêu Cầu Hỗ Trợ";

    await Promise.all(
      managerUserIds.map((managerUserId) =>
        notificationService.sendToUser(managerUserId, {
          title: titleLabel,
          message: `Khách hàng tại Pod ${podCode || 'Không rõ'} vừa gửi yêu cầu ${typeLabel}, vui lòng kiểm tra.`,
          type: "SUPPORT",
          event_code: "SUPPORT_REQUEST_CREATED",
          dedupe_key: `SUPPORT_REQUEST_CREATED:${supportRequest.id}:${managerUserId}`,
          data: {
            support_request_id: supportRequest.id,
            booking_id: supportRequest.booking_id,
            pod_id: supportRequest.pod_id,
            pod_code: podCode,
            status: String(supportRequest.status || "PENDING").toUpperCase(),
            type: normalizeUpper(supportRequest.type),
          },
        })
      )
    );
  }

  async createSupportRequest(actor, payload = {}) {
    const actorId = this._getActorId(actor);
    const actorRole = this._getActorRole(actor);
    if (!actorId) {
      throw createError("Unauthorized", 401);
    }

    if (actorRole !== "user") {
      throw createError("Only user can create support requests", 403);
    }

    const { booking_id, type, description, images = [] } = payload;
    const normalizedType = normalizeUpper(type);

    if (!booking_id || !normalizedType || !description) {
      throw createError("booking_id, type and description are required", 400);
    }

    if (!SUPPORT_TYPES.includes(normalizedType)) {
      throw createError(`type must be one of ${SUPPORT_TYPES.join(", ")}`, 400);
    }

    if (!Array.isArray(images)) {
      throw createError("images must be an array of URL strings", 400);
    }

    const normalizedImages = images.map((item) => String(item || "").trim()).filter(Boolean);

    const booking = await Booking.findOne({ id: booking_id }).select(
      "id user_id pod_id status start_time end_time"
    );

    if (!booking) {
      throw createError("Booking not found", 404);
    }

    if (String(booking.user_id) !== actorId) {
      throw createError("You can only create support requests for your own booking", 403);
    }

    if (normalizeUpper(booking.status) !== "IN_USE") {
      throw createError("Support request can only be created when booking is IN_USE", 400);
    }

    const activeRequest = await SupportRequest.findOne({
      booking_id: String(booking_id),
      status: { $in: ACTIVE_SUPPORT_STATUSES },
    })
      .select("id status")
      .lean();

    if (activeRequest) {
      throw createError("This booking already has an active support request", 409);
    }

    if (normalizedType === "MAINTENANCE" && normalizedImages.length === 0) {
      throw createError("Maintenance request requires at least one evidence image", 400);
    }


    const pod = await Pod.findOne({ id: booking.pod_id }).select("id cluster_id code name");
    if (!pod) {
      throw createError("Pod not found for this booking", 404);
    }

    const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id");
    if (!cluster) {
      throw createError("Pod cluster not found for this booking", 404);
    }

    try {
      const supportRequest = await SupportRequest.create({
        booking_id,
        pod_id: booking.pod_id,
        location_id: cluster.location_id,
        user_id: actorId,
        type: normalizedType,
        description,
        images: normalizedImages,
        status: "PENDING",
      });

      if (normalizedType === "CLEANING") {
        await this._notifyCleanersForCleaningSupport(supportRequest, booking);
      }

      const podCode = pod.code || pod.name || booking.pod_id;
      await this._notifyManagersForSupportRequest(supportRequest, podCode);

      return supportRequest;
    } catch (error) {
      if (error && error.code === 11000) {
        throw createError("This booking already has an active support request", 409);
      }
      throw error;
    }
  }

  async getSupportRequests(actor, managerScope, filters = {}) {
    const role = this._getActorRole(actor);
    const actorId = this._getActorId(actor);
    const { status, type, severity, booking_id, page = 1, limit = 20 } = filters;

    const query = {};

    if (status) query.status = normalizeSupportStatus(status);
    if (type) query.type = normalizeUpper(type);
    if (severity) query.severity = normalizeUpper(severity);
    if (booking_id) query.booking_id = String(booking_id);

    if (role === "user") {
      query.user_id = actorId;
    } else if (role === "manager") {
      const locationIds = (managerScope && managerScope.locationIds) || [];
      query.location_id = { $in: locationIds.map((item) => String(item)) };
    } else {
      throw createError("Not authorized to view support requests", 403);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      SupportRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("booking", "id user_id pod_id status start_time end_time")
        .populate("handler", "_id name email role")
        .populate("user", "_id id name email role"),
      SupportRequest.countDocuments(query),
    ]);

    return {
      requests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    };
  }

  async getSupportRequestById(requestId, actor, managerScope) {
    const role = this._getActorRole(actor);
    const actorId = this._getActorId(actor);

    const supportRequest = await SupportRequest.findOne({ id: requestId })
      .populate("booking", "id user_id pod_id status start_time end_time")
      .populate("handler", "_id name email role")
      .populate("user", "_id id name email role");

    if (!supportRequest) {
      throw createError("Support request not found", 404);
    }

    if (role === "user") {
      if (String(supportRequest.user_id) !== actorId) {
        throw createError("Not authorized to view this support request", 403);
      }
    } else if (role === "manager") {
      await this._assertManagerScopeAccess(supportRequest, managerScope);
    } else {
      throw createError("Not authorized to view support requests", 403);
    }

    return supportRequest;
  }

  async updateSupportRequestStatus(requestId, actor, managerScope, payload = {}) {
    const actorId = this._getActorId(actor);
    const actorRole = this._getActorRole(actor);
    const { status, severity, escalation_note, resolution_note } = payload;

    if (actorRole !== "manager") {
      throw createError("Only manager can handle support request status", 403);
    }

    if (!status) {
      throw createError("status is required", 400);
    }

    const normalizedStatus = normalizeSupportStatus(status);
    if (!SUPPORT_STATUSES.includes(normalizedStatus)) {
      throw createError(`status must be one of ${SUPPORT_STATUSES.join(", ")}`, 400);
    }

    const supportRequest = await SupportRequest.findOne({ id: requestId });
    if (!supportRequest) {
      throw createError("Support request not found", 404);
    }

    await this._ensureSupportRequestContext(supportRequest);
    await this._assertManagerScopeAccess(supportRequest, managerScope);

    const currentStatus = normalizeSupportStatus(supportRequest.status);
    const allowedTransitions = {
      PENDING: ["PROCESSING", "REJECTED", "CANCELED", "EXPIRED"],
      PROCESSING: ["IN_PROGRESS", "ESCALATED", "REJECTED", "CANCELED", "EXPIRED"],
      IN_PROGRESS: ["ESCALATED", "RESOLVED", "REJECTED", "EXPIRED"],
      ESCALATED: ["IN_PROGRESS", "RESOLVED", "REJECTED", "EXPIRED"],
      RESOLVED: [],
      REJECTED: [],
      CANCELED: [],
      EXPIRED: [],
    };

    if (currentStatus !== normalizedStatus) {
      const transitions = allowedTransitions[currentStatus] || [];
      if (!transitions.includes(normalizedStatus)) {
        throw createError(`Cannot change support request status from ${currentStatus} to ${normalizedStatus}`, 400);
      }
    }

    const normalizedSeverity = severity ? normalizeUpper(severity) : null;
    if (normalizedSeverity) {
      if (normalizeUpper(supportRequest.type) !== "MAINTENANCE") {
        throw createError("severity is only supported for MAINTENANCE requests", 400);
      }
      if (!MAINTENANCE_SEVERITIES.includes(normalizedSeverity)) {
        throw createError(`severity must be one of ${MAINTENANCE_SEVERITIES.join(", ")}`, 400);
      }
      supportRequest.severity = normalizedSeverity;
    }

    const effectiveSeverity = normalizeUpper(supportRequest.severity || normalizedSeverity || "");
    if (normalizedStatus === "ESCALATED") {
      if (normalizeUpper(supportRequest.type) !== "MAINTENANCE") {
        throw createError("Only MAINTENANCE request can be escalated", 400);
      }
      if (!["HIGH", "CRITICAL"].includes(effectiveSeverity)) {
        throw createError("Escalated MAINTENANCE request requires severity HIGH or CRITICAL", 400);
      }
      if (!String(escalation_note || "").trim()) {
        throw createError("escalation_note is required when status is ESCALATED", 400);
      }
      supportRequest.escalation_note = String(escalation_note).trim();
    }

    if (["RESOLVED", "REJECTED"].includes(normalizedStatus) && !String(resolution_note || "").trim()) {
      throw createError("resolution_note is required when status is RESOLVED or REJECTED", 400);
    }

    if (["IN_PROGRESS", "ESCALATED", "RESOLVED", "REJECTED", "EXPIRED"].includes(normalizedStatus)) {
      supportRequest.handled_by = actorId;
      supportRequest.handled_at = new Date();
    }

    if (resolution_note !== undefined) {
      supportRequest.resolution_note = String(resolution_note || "").trim() || null;
    }

    supportRequest.status = normalizedStatus;
    await supportRequest.save();

    if (normalizedStatus === "ESCALATED") {
      const booking = await Booking.findOne({ id: supportRequest.booking_id }).select("id").lean();
      await this._notifyAdminsForEscalation(supportRequest, booking);
    }

    const socketServer = getSocketServer();
    if (socketServer) {
      socketServer.to(`user:${supportRequest.user_id}`).emit("SUPPORT_REQUEST_UPDATED", {
        request_id: supportRequest.id,
        status: supportRequest.status,
        updated_at: new Date(),
      });
    }

    return supportRequest;
  }

  async getRoomChangeCandidates(requestId, actor, managerScope, filters = {}) {
    if (this._getActorRole(actor) !== "manager") {
      throw createError("Only manager can view room-change candidates", 403);
    }

    const { page = 1, limit = 20 } = filters;

    const supportRequest = await SupportRequest.findOne({ id: requestId });
    if (!supportRequest) {
      throw createError("Support request not found", 404);
    }

    await this._ensureSupportRequestContext(supportRequest);
    await this._assertManagerScopeAccess(supportRequest, managerScope);

    if (!SUPPORT_TYPES.includes(normalizeUpper(supportRequest.type))) {
      throw createError("Support request type does not support room-change operation", 400);
    }

    const booking = await Booking.findOne({ id: supportRequest.booking_id }).select(
      "id user_id pod_id start_time end_time status"
    );
    if (!booking) {
      throw createError("Booking not found for support request", 404);
    }

    if (normalizeUpper(booking.status) !== "IN_USE") {
      throw createError("Room change is only allowed when booking is IN_USE", 400);
    }

    const currentPod = await Pod.findOne({ id: booking.pod_id }).select("id code name cluster_id status");

    if (!currentPod) {
      throw createError("Current booking pod not found", 404);
    }

    const resolvedCurrentCluster = await PodCluster.findOne({ id: currentPod.cluster_id }).select("id name location_id");
    if (!resolvedCurrentCluster) {
      throw createError("Current pod cluster not found", 404);
    }

    const candidates = await this._getRoomChangeCandidates(booking, currentPod, resolvedCurrentCluster, managerScope);
    const total = candidates.length;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedCandidates = candidates.slice(startIndex, endIndex);

    return {
      request: supportRequest,
      booking,
      current_pod: currentPod,
      candidates: paginatedCandidates,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum) || 1,
      }
    };
  }

  async executeRoomChange(requestId, actor, managerScope, payload = {}) {
    if (this._getActorRole(actor) !== "manager") {
      throw createError("Only manager can execute room change", 403);
    }

    const targetPodId = String(payload.target_pod_id || "").trim();
    if (!targetPodId) {
      throw createError("target_pod_id is required", 400);
    }

    const supportRequest = await SupportRequest.findOne({ id: requestId });
    if (!supportRequest) {
      throw createError("Support request not found", 404);
    }

    await this._ensureSupportRequestContext(supportRequest);
    await this._assertManagerScopeAccess(supportRequest, managerScope);

    const requestType = normalizeUpper(supportRequest.type);
    if (!SUPPORT_TYPES.includes(requestType)) {
      throw createError("Support request type does not support room-change operation", 400);
    }

    const currentStatus = normalizeSupportStatus(supportRequest.status);
    if (!["IN_PROGRESS", "ESCALATED"].includes(currentStatus)) {
      throw createError(`Cannot execute room change when request status is ${currentStatus}`, 400);
    }

    const booking = await Booking.findOne({ id: supportRequest.booking_id });
    if (!booking) {
      throw createError("Booking not found for support request", 404);
    }

    if (normalizeUpper(booking.status) !== "IN_USE") {
      throw createError("Room change is only allowed when booking is IN_USE", 400);
    }

    const [currentPod, nextPod] = await Promise.all([
      Pod.findOne({ id: booking.pod_id }).select("id code name cluster_id status maintenance_status"),
      Pod.findOne({ id: targetPodId }).select("id code name cluster_id status"),
    ]);

    if (!currentPod) {
      throw createError("Current booking pod not found", 404);
    }

    if (!nextPod) {
      throw createError("Target pod not found", 404);
    }

    if (normalizeUpper(nextPod.status) !== "AVAILABLE") {
      throw createError("Target pod must be AVAILABLE", 400);
    }

    const [currentCluster, nextCluster] = await Promise.all([
      PodCluster.findOne({ id: currentPod.cluster_id }).select("id name location_id"),
      PodCluster.findOne({ id: nextPod.cluster_id }).select("id name location_id"),
    ]);

    if (!currentCluster || !nextCluster) {
      throw createError("Pod cluster not found", 404);
    }

    const nextLocation = await Location.findOne({ id: nextCluster.location_id }).select("id name");

    const currentParent = await this._resolveTopParentLocationId(currentCluster.location_id);
    const nextParent = await this._resolveTopParentLocationId(nextCluster.location_id);

    const isSameCluster = String(currentCluster.id) === String(nextCluster.id);
    const isSameParentLocation = Boolean(currentParent) && String(currentParent) === String(nextParent);
    if (!isSameCluster && !isSameParentLocation) {
      throw createError("Target pod must be in same cluster or same parent location", 400);
    }

    const scopePodIds = new Set(((managerScope && managerScope.podIds) || []).map((item) => String(item)));
    if (scopePodIds.size > 0 && !scopePodIds.has(String(nextPod.id))) {
      throw createError("You are not allowed to move booking to this pod", 403);
    }

    const bufferMinutes = await this._resolveCleaningBufferMinutes({
      podId: nextPod.id,
      clusterId: nextCluster.id,
      locationId: nextCluster.location_id,
    });
    const remainingStart = new Date();
    const bufferedEnd = new Date(new Date(booking.end_time).getTime() + bufferMinutes * 60 * 1000);

    if (remainingStart >= bufferedEnd) {
      throw createError("Booking remaining time is invalid for room change", 400);
    }

    const isAvailable = await Booking.isPodAvailable(nextPod.id, remainingStart, bufferedEnd, booking.id);
    if (!isAvailable) {
      throw createError("Target pod is not available for the remaining booking window", 409);
    }

    const conflictingTimeSlot = await TimeSlot.findOne({
      pod_id: nextPod.id,
      status: "RESERVED",
      start_time: { $lt: bufferedEnd },
      end_time: { $gt: remainingStart },
    }).select("id");

    if (conflictingTimeSlot) {
      throw createError("Target pod has conflicting reserved slots in remaining booking window", 409);
    }

    booking.pod_id = nextPod.id;
    await booking.save();

    const bookingSlots = await BookingSlot.find({ booking_id: booking.id }).select("time_slot_id");
    const timeSlotIds = bookingSlots.map((slot) => slot.time_slot_id);

    if (timeSlotIds.length > 0) {
      await TimeSlot.updateMany(
        { id: { $in: timeSlotIds } },
        { $set: { pod_id: nextPod.id } }
      );
    }

    await OnlineKey.updateMany(
      { booking_id: booking.id, is_revoked: false, key_type: { $ne: "CLEANER" } },
      { $set: { pod_id: nextPod.id } }
    );

    const oldPodNextStatusRaw = String(payload.old_pod_next_status || "").trim().toUpperCase();
    const oldPodNextStatus = ["MAINTENANCE", "NEEDS_CLEANING"].includes(oldPodNextStatusRaw)
      ? oldPodNextStatusRaw
      : requestType === "MAINTENANCE"
        ? "MAINTENANCE"
        : "NEEDS_CLEANING";

    currentPod.status = oldPodNextStatus;
    if (oldPodNextStatus === "MAINTENANCE") {
      currentPod.maintenance_status = String(payload.old_pod_reason || supportRequest.description || "") || null;
    }
    await currentPod.save();

    if (oldPodNextStatus === "NEEDS_CLEANING") {
      try {
        const now = new Date();
        const existingOldPodTask = await CleaningTask.findOne({
          booking_id: booking.id,
          pod_id: currentPod.id,
          status: { $in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
        }).sort({ created_at: -1 });

        if (existingOldPodTask) {
          existingOldPodTask.estimated_start_time = new Date(now.getTime() + 5 * 60 * 1000);
          existingOldPodTask.due_at = new Date(now.getTime() + 30 * 60 * 1000);
          existingOldPodTask.request_source = "ROOM_CHANGE_VACATED";
          await existingOldPodTask.save();

          await notifyCleanerOldPodNeedsCleaningAfterRoomChange({
            task: existingOldPodTask,
            oldPod: currentPod,
            newPod: nextPod,
            supportRequest,
          });
        }

        await cleaningTaskService.autoAssignTaskForBooking(
          {
            id: booking.id,
            pod_id: nextPod.id,
            status: "IN_USE",
            checkin_state: booking.checkin_state || null,
            end_time: booking.end_time,
          },
          { trigger: "ROOM_CHANGE_AFTER_CHECKOUT" }
        );
      } catch (cleaningErr) {
        console.error(`[executeRoomChange] Failed to auto-assign cleaning task for old pod ${currentPod.id}:`, cleaningErr.message);
      }
    }

    supportRequest.pod_id = nextPod.id;
    supportRequest.location_id = nextCluster.location_id;

    const actorId = this._getActorId(actor);
    supportRequest.handled_by = actorId;
    supportRequest.handled_at = new Date();

    const effectiveSeverity = normalizeUpper(payload.severity || supportRequest.severity || "");
    if (requestType === "MAINTENANCE" && !["HIGH", "CRITICAL"].includes(effectiveSeverity)) {
      throw createError("MAINTENANCE room change is only allowed for severity HIGH or CRITICAL", 400);
    }

    if (requestType === "MAINTENANCE" && MAINTENANCE_SEVERITIES.includes(effectiveSeverity)) {
      supportRequest.severity = effectiveSeverity;
    }

    if (requestType === "MAINTENANCE" && ["HIGH", "CRITICAL"].includes(normalizeUpper(supportRequest.severity))) {
      supportRequest.status = "ESCALATED";
      supportRequest.escalation_note = String(payload.escalation_note || "").trim() || "Đã chuyển cấp lên ban quản trị sau khi thực hiện dời phòng khẩn cấp do sự cố bảo trì.";
    } else {
      supportRequest.status = "RESOLVED";
    }

    supportRequest.resolution_note =
      String(payload.resolution_note || "").trim() ||
      `Hệ thống đã dời khách hàng từ phòng ${currentPod.code || currentPod.id} sang phòng ${nextPod.code || nextPod.id}`;

    await supportRequest.save();

    if (supportRequest.status === "ESCALATED") {
      await this._notifyAdminsForEscalation(supportRequest, booking);
    }

    const latestPodQr = await PodQrCode.findOne({
      pod_id: nextPod.id,
      is_active: true,
      expires_at: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const newPodQrToken = latestPodQr ? latestPodQr.qr_token : null;

    const roomChangeData = {
      support_request_id: supportRequest.id,
      booking_id: booking.id,
      old_pod_id: currentPod.id,
      new_pod_id: nextPod.id,
      new_pod_code: nextPod.code,
      new_pod_name: nextPod.name,
      new_cluster_id: nextCluster.id,
      new_cluster_name: nextCluster.name,
      new_location_id: nextLocation ? nextLocation.id : nextCluster.location_id,
      new_location_name: nextLocation ? nextLocation.name : null,
      new_pod_qr_token: newPodQrToken,
    };

    const socketServer = getSocketServer();
    if (socketServer) {
      socketServer.to(`user:${booking.user_id}`).emit("SUPPORT_REQUEST_UPDATED", {
        request_id: supportRequest.id,
        status: supportRequest.status,
        updated_at: new Date(),
        room_change_data: roomChangeData
      });
    }

    await notificationService.sendToUser(booking.user_id, {
      title: "Phòng của bạn đã được thay đổi",
      message: "Quản lý đã sắp xếp lại phòng cho bạn để đảm bảo trải nghiệm. Vui lòng kiểm tra màn hình để lấy mã phòng và lối đi mới.",
      type: "SUPPORT",
      event_code: "SUPPORT_ROOM_CHANGED",
      dedupe_key: `SUPPORT_ROOM_CHANGED:${supportRequest.id}:${booking.id}`,
      data: roomChangeData,
    });

    return {
      support_request: supportRequest,
      booking,
      old_pod: currentPod,
      new_pod: nextPod,
      new_pod_qr_token: newPodQrToken,
      buffer_minutes_applied: bufferMinutes,
      escalated_to_admin: supportRequest.status === "ESCALATED",
    };
  }

  async cancelSupportRequest(requestId, actor) {
    const actorId = this._getActorId(actor);

    if (this._getActorRole(actor) !== "user") {
      throw createError("Only users can cancel their support request", 403);
    }

    const supportRequest = await SupportRequest.findOne({ id: requestId });
    if (!supportRequest) {
      throw createError("Support request not found", 404);
    }

    if (String(supportRequest.user_id) !== actorId) {
      throw createError("Not authorized to cancel this request", 403);
    }

    const currentStatus = normalizeSupportStatus(supportRequest.status);
    if (!["PENDING", "PROCESSING"].includes(currentStatus)) {
      throw createError(`Cannot cancel request in ${currentStatus} status`, 400);
    }

    supportRequest.status = "CANCELED";
    await supportRequest.save();

    const socketServer = getSocketServer();
    if (socketServer) {
      socketServer.to(`user:${supportRequest.user_id}`).emit("SUPPORT_REQUEST_UPDATED", {
        request_id: supportRequest.id,
        status: supportRequest.status,
        updated_at: new Date(),
      });
    }

    return supportRequest;
  }
}

module.exports = new SupportRequestService();
