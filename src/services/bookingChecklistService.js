const BookingChecklist = require("../models/BookingChecklist");
const Booking = require("../models/Bookings");
const Pod = require("../models/Pod");
const PodItem = require("../models/PodItem");
const Item = require("../models/Item");
const Incident = require("../models/Incidents");
const IncidentMedia = require("../models/IncidentMedia");
const IncidentDetail = require("../models/IncidentDetail");
const PodCluster = require("../models/PodCluster");
const CleaningTask = require("../models/CleaningTask");
const notificationService = require("./notificationService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const User = require("../models/User");
const mongoose = require("mongoose");

const AUTO_ACCEPT_TIMEOUT_MINUTES = Number(
  process.env.CHECKLIST_AUTO_ACCEPT_TIMEOUT_MINUTES || 10
);
const AUTO_ACCEPT_JOB_INTERVAL_MINUTES = Number(
  process.env.CHECKLIST_AUTO_ACCEPT_JOB_INTERVAL_MINUTES || 2
);

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// ─── Helpers ──────────────────────────────────────────────────────

const resolveCleanersForPod = async (podId) => {
  if (!podId) return [];

  const pod = await Pod.findOne({ id: podId }).select("cluster_id").lean();
  if (!pod || !pod.cluster_id) return [];

  const rosters = await StaffWorkRoster.find({
    cluster_id: pod.cluster_id,
    is_active: true
  }).select("staff_id").lean();

  if (!rosters.length) return [];

  const staffIds = [
    ...new Set(
      rosters.map((a) => String(a.staff_id || "")).filter(Boolean)
    ),
  ];

  if (!staffIds.length) return [];

  const objectIds = staffIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const cleaners = await User.find({
    role: "cleaner",
    isActive: true,
    $or: [{ id: { $in: staffIds } }, { _id: { $in: objectIds } }],
  })
    .select("_id")
    .lean();

  return [
    ...new Set(
      cleaners.map((c) => String(c._id || "")).filter(Boolean)
    ),
  ];
};

const resolveBookingForChecklist = async (bookingId, userId) => {
  const booking = await Booking.findOne({ id: bookingId })
    .select("id user_id pod_id status is_checklist_completed checked_in_at")
    .lean();

  if (!booking) {
    throw createError("Booking not found", 404);
  }

  // user_id in booking can be either _id (ObjectId) or id (UUID)
  const bookingUserId = String(booking.user_id || "");
  const actorIds = [userId]
    .filter(Boolean)
    .map((v) => String(v));

  // Also resolve the user's other identity
  const userQuery = mongoose.Types.ObjectId.isValid(userId)
    ? { $or: [{ id: userId }, { _id: userId }] }
    : { id: userId };
  const user = await User.findOne(userQuery).select("_id id").lean();
  if (user) {
    if (user._id) actorIds.push(String(user._id));
    if (user.id) actorIds.push(String(user.id));
  }

  if (!actorIds.includes(bookingUserId)) {
    throw createError("You are not authorized to access this booking", 403);
  }

  return booking;
};

// ─── API 1: Get checklist items ──────────────────────────────────

const getChecklistItems = async (bookingId, userId) => {
  const booking = await resolveBookingForChecklist(bookingId, userId);

  if (!["IN_USE", "BOOKED"].includes(booking.status)) {
    throw createError(
      "Checklist is only available for bookings that are BOOKED or IN_USE",
      400
    );
  }

  const podItems = await PodItem.find({ pod_id: booking.pod_id })
    .select("id pod_id item_id expected_quantity current_quantity")
    .lean();

  if (!podItems.length) {
    return {
      booking_id: booking.id,
      pod_id: booking.pod_id,
      is_checklist_completed: booking.is_checklist_completed,
      items: [],
    };
  }

  const itemIds = podItems.map((pi) => pi.item_id);
  const items = await Item.find({
    id: { $in: itemIds },
    item_type: "REUSABLE",
  })
    .select("id name item_type")
    .lean();

  const itemById = new Map(items.map((item) => [String(item.id), item]));

  // Only include REUSABLE items
  const checklistItems = podItems
    .filter((pi) => itemById.has(String(pi.item_id)))
    .map((pi) => {
      const item = itemById.get(String(pi.item_id));
      return {
        item_id: item.id,
        item_name: item.name,
        expected_quantity: pi.expected_quantity,
      };
    });

  // Check if already have existing checklist records
  const existingChecklist = await BookingChecklist.find({
    booking_id: booking.id,
    type: "CHECKIN",
  })
    .select("item_id reported_status reported_quantity photo_url incident_id")
    .lean();

  const existingMap = new Map(
    existingChecklist.map((c) => [String(c.item_id), c])
  );

  const enrichedItems = checklistItems.map((item) => {
    const existing = existingMap.get(String(item.item_id));
    return {
      ...item,
      reported_status: existing ? existing.reported_status : null,
      reported_quantity: existing ? existing.reported_quantity : null,
      photo_url: existing ? existing.photo_url : null,
      incident_id: existing ? existing.incident_id : null,
    };
  });

  return {
    booking_id: booking.id,
    pod_id: booking.pod_id,
    is_checklist_completed: booking.is_checklist_completed,
    items: enrichedItems,
  };
};

// ─── API 2: Confirm checklist ────────────────────────────────────

const confirmChecklist = async (bookingId, userId, itemsPayload) => {
  const booking = await resolveBookingForChecklist(bookingId, userId);

  if (booking.status !== "IN_USE") {
    throw createError("Checklist can only be confirmed for IN_USE bookings", 400);
  }

  if (booking.is_checklist_completed) {
    throw createError("Checklist has already been completed for this booking", 409);
  }

  if (!Array.isArray(itemsPayload) || itemsPayload.length === 0) {
    throw createError("items is required and must be a non-empty array", 400);
  }

  // Validate items exist and are REUSABLE
  const podItems = await PodItem.find({ pod_id: booking.pod_id })
    .select("item_id expected_quantity")
    .lean();

  const itemIds = podItems.map((pi) => pi.item_id);
  const reusableItems = await Item.find({
    id: { $in: itemIds },
    item_type: "REUSABLE",
  })
    .select("id name unit_cost")
    .lean();

  const reusableItemById = new Map(
    reusableItems.map((item) => [String(item.id), item])
  );
  const podItemByItemId = new Map(
    podItems
      .filter((pi) => reusableItemById.has(String(pi.item_id)))
      .map((pi) => [String(pi.item_id), pi])
  );

  const VALID_STATUSES = ["MATCHED", "DAMAGED", "MISSING"];
  const now = new Date();
  const checklistDocs = [];
  const incidentItems = [];

  for (let i = 0; i < itemsPayload.length; i++) {
    const entry = itemsPayload[i];
    const itemId = String(entry?.item_id || "").trim();

    if (!itemId) {
      throw createError(`items[${i}].item_id is required`, 400);
    }

    const reusableItem = reusableItemById.get(itemId);
    if (!reusableItem) {
      throw createError(
        `items[${i}].item_id "${itemId}" is not a valid REUSABLE item in this pod`,
        400
      );
    }

    const status = String(entry?.status || "").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      throw createError(
        `items[${i}].status must be one of: ${VALID_STATUSES.join(", ")}`,
        400
      );
    }

    const podItem = podItemByItemId.get(itemId);
    const expectedQty = podItem ? podItem.expected_quantity : 0;
    const reportedQty =
      entry?.quantity !== undefined ? Number(entry.quantity) : expectedQty;

    if (reportedQty < 0 || reportedQty > expectedQty) {
      throw createError(
        `Số lượng báo cáo cho vật dụng "${reusableItem.name}" (${reportedQty}) không hợp lệ. Số lượng tối đa trong phòng là ${expectedQty}.`,
        400
      );
    }

    if ((status === "DAMAGED" || status === "MISSING") && reportedQty <= 0) {
      throw createError(
        `Số lượng báo cáo cho vật dụng "${reusableItem.name}" phải lớn hơn 0 khi báo thiếu hoặc hỏng.`,
        400
      );
    }

    const doc = {
      booking_id: booking.id,
      pod_id: booking.pod_id,
      item_id: itemId,
      item_name: reusableItem.name,
      unit_cost: reusableItem.unit_cost || 0,
      type: "CHECKIN",
      expected_quantity: expectedQty,
      reported_status: status,
      reported_quantity: reportedQty,
      incident_id: null,
      confirmed_by: "USER",
      confirmed_at: now,
    };

    checklistDocs.push(doc);

    if (status === "DAMAGED" || status === "MISSING") {
      incidentItems.push({
        doc,
        index: i,
      });
    }
  }

  // Insert checklist records
  const created = await BookingChecklist.insertMany(checklistDocs, {
    ordered: false,
  });

  const createdMap = new Map(
    created.map((c) => [String(c.item_id), c])
  );

  // Create incidents for DAMAGED/MISSING items
  const createdIncidents = [];
  for (const { doc } of incidentItems) {
    const descParts = [];
    if (doc.reported_status === "DAMAGED") {
      descParts.push(`${doc.reported_quantity} ${doc.item_name} bị hư hỏng`);
    } else {
      descParts.push(`${doc.reported_quantity} ${doc.item_name} bị thiếu`);
    }
    descParts.push(`(Số lượng tiêu chuẩn của phòng: ${doc.expected_quantity})`);

    const estimatedValue = doc.unit_cost * doc.reported_quantity;

    const incident = await Incident.create({
      pod_id: doc.pod_id,
      incident_type: "REPLENISHMENT_REQUEST",
      booking_id: doc.booking_id,
      reported_by: userId,
      description: descParts.join(" "),
      severity: "MEDIUM",
      status: "PENDING",
      estimated_total_value: null,
    });

    // Link incident to checklist record
    const checklistRecord = createdMap.get(String(doc.item_id));
    if (checklistRecord) {
      checklistRecord.incident_id = incident.id;
      await checklistRecord.save();
    }

    createdIncidents.push({
      incident_id: incident.id,
      item_name: doc.item_name,
      status: doc.reported_status,
      quantity: doc.reported_quantity,
    });
  }

  // Mark booking checklist as completed
  await Booking.updateOne(
    { id: booking.id },
    {
      $set: {
        is_checklist_completed: true,
        checklist_completed_at: now,
      },
    }
  );

  // Notify cleaners if there are issues
  if (createdIncidents.length > 0) {
    _notifyCleanersAboutChecklistIssues(booking, createdIncidents).catch(
      (error) => {
        console.error("Failed to notify cleaners about checklist issues", {
          booking_id: booking.id,
          error: error?.message || error,
        });
      }
    );
  }

  return {
    booking_id: booking.id,
    pod_id: booking.pod_id,
    is_checklist_completed: true,
    total_items: checklistDocs.length,
    matched_count: checklistDocs.filter(
      (d) => d.reported_status === "MATCHED"
    ).length,
    issue_count: createdIncidents.length,
    incidents: createdIncidents,
    message:
      createdIncidents.length > 0
        ? `Checklist hoàn tất. Đã báo cáo ${createdIncidents.length} sự cố.`
        : "Checklist hoàn tất. Tất cả vật dụng đầy đủ và hoạt động tốt.",
  };
};

// ─── Notify cleaners ─────────────────────────────────────────────

const _notifyCleanersAboutChecklistIssues = async (booking, incidents) => {
  const cleanerUserIds = await resolveCleanersForPod(booking.pod_id);

  const pod = await Pod.findOne({ id: booking.pod_id })
    .select("id code name")
    .lean();

  const podLabel = pod ? pod.code || pod.name || pod.id : booking.pod_id;
  const issueList = incidents
    .map((inc) => `${inc.item_name} (${inc.status})`)
    .join(", ");

  for (const cleanerUserId of cleanerUserIds) {
    await notificationService.sendToUser(cleanerUserId, {
      title: `Yêu cầu bổ sung đồ tại Pod ${podLabel}`,
      message: `Khách báo cáo: ${issueList}. Vui lòng bổ sung ngay.`,
      type: "INCIDENT",
      event_code: "CHECKLIST_ISSUE_REPORTED",
      dedupe_key: `CHECKLIST_ISSUE_REPORTED:${booking.id}:${cleanerUserId}`,
      data: {
        type: "CHECKLIST_ISSUE_REPORTED",
        booking_id: booking.id,
        pod_id: booking.pod_id,
        pod_code: podLabel,
        incident_count: String(incidents.length),
      },
    });

    emitCleanerNotificationEvent({
      user_id: cleanerUserId,
      notification: {
        event: "CHECKLIST_ISSUE_REPORTED",
        payload: {
          booking_id: booking.id,
          pod_id: booking.pod_id,
          pod_code: podLabel,
          issues: issueList,
        },
      },
    });
  }
};

// ─── API 3: Get checklist status ─────────────────────────────────

const getChecklistStatus = async (bookingId, userId) => {
  const booking = await resolveBookingForChecklist(bookingId, userId);

  return {
    booking_id: booking.id,
    status: booking.status,
    is_checklist_completed: booking.is_checklist_completed,
    checked_in_at: booking.checked_in_at || null,
  };
};

// ─── Auto-accept expired checklists ──────────────────────────────

const autoAcceptExpiredChecklists = async () => {
  const timeoutMs = AUTO_ACCEPT_TIMEOUT_MINUTES * 60 * 1000;
  const cutoffTime = new Date(Date.now() - timeoutMs);

  // Find bookings IN_USE, checked in before cutoff, checklist not completed
  const expiredBookings = await Booking.find({
    status: "IN_USE",
    is_checklist_completed: false,
    checked_in_at: { $ne: null, $lte: cutoffTime },
  })
    .select("id user_id pod_id checked_in_at")
    .lean();

  if (!expiredBookings.length) return { processed: 0 };

  let processed = 0;

  for (const booking of expiredBookings) {
    try {
      // Check if already has checklist records (partial submit edge case)
      const existingCount = await BookingChecklist.countDocuments({
        booking_id: booking.id,
        type: "CHECKIN",
      });

      if (existingCount > 0) {
        // Already has records, just mark as completed
        await Booking.updateOne(
          { id: booking.id },
          {
            $set: {
              is_checklist_completed: true,
              checklist_completed_at: new Date(),
            },
          }
        );
        processed++;
        continue;
      }

      // Get REUSABLE items for this pod
      const podItems = await PodItem.find({ pod_id: booking.pod_id })
        .select("item_id expected_quantity")
        .lean();

      const itemIds = podItems.map((pi) => pi.item_id);
      const reusableItems = await Item.find({
        id: { $in: itemIds },
        item_type: "REUSABLE",
      })
        .select("id name")
        .lean();

      const reusableItemById = new Map(
        reusableItems.map((item) => [String(item.id), item])
      );

      const now = new Date();
      const checklistDocs = podItems
        .filter((pi) => reusableItemById.has(String(pi.item_id)))
        .map((pi) => {
          const item = reusableItemById.get(String(pi.item_id));
          return {
            booking_id: booking.id,
            pod_id: booking.pod_id,
            item_id: pi.item_id,
            item_name: item.name,
            type: "CHECKIN",
            expected_quantity: pi.expected_quantity,
            reported_status: "MATCHED_BY_SYSTEM",
            reported_quantity: pi.expected_quantity,
            confirmed_by: "SYSTEM",
            confirmed_at: now,
          };
        });

      if (checklistDocs.length > 0) {
        await BookingChecklist.insertMany(checklistDocs, { ordered: false });
      }

      await Booking.updateOne(
        { id: booking.id },
        {
          $set: {
            is_checklist_completed: true,
            checklist_completed_at: now,
          },
        }
      );

      // Notify user
      const userObjectId = mongoose.Types.ObjectId.isValid(booking.user_id)
        ? booking.user_id
        : null;

      const user = await User.findOne(
        userObjectId
          ? { $or: [{ id: booking.user_id }, { _id: userObjectId }] }
          : { id: booking.user_id }
      )
        .select("_id")
        .lean();

      const notifyUserId = user ? String(user._id) : null;

      if (notifyUserId) {
        await notificationService
          .sendToUser(notifyUserId, {
            title: "Checklist tự động xác nhận",
            message: `Vì bạn đã vào phòng quá ${AUTO_ACCEPT_TIMEOUT_MINUTES} phút mà không có phản hồi, OasisGo mặc định bạn đã nhận đủ vật dụng trong tình trạng tốt.`,
            type: "BOOKING",
            event_code: "CHECKLIST_AUTO_ACCEPTED",
            dedupe_key: `CHECKLIST_AUTO_ACCEPTED:${booking.id}`,
            data: {
              type: "CHECKLIST_AUTO_ACCEPTED",
              booking_id: booking.id,
              pod_id: booking.pod_id,
              timeout_minutes: String(AUTO_ACCEPT_TIMEOUT_MINUTES),
            },
          })
          .catch((error) => {
            console.error("Failed to send auto-accept notification", {
              booking_id: booking.id,
              error: error?.message || error,
            });
          });
      }

      processed++;
    } catch (error) {
      console.error("Auto-accept checklist failed for booking", {
        booking_id: booking.id,
        error: error?.message || error,
      });
    }
  }

  if (processed > 0) {
    console.log(
      `Auto-accepted checklists for ${processed}/${expiredBookings.length} expired booking(s)`
    );
  }

  return { processed, total: expiredBookings.length };
};

// ─── Scheduler ───────────────────────────────────────────────────

let autoAcceptJobInterval = null;

const startAutoAcceptJob = (intervalMinutes = AUTO_ACCEPT_JOB_INTERVAL_MINUTES) => {
  if (autoAcceptJobInterval) {
    clearInterval(autoAcceptJobInterval);
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `Starting checklist auto-accept job (interval: ${intervalMinutes} minute(s), timeout: ${AUTO_ACCEPT_TIMEOUT_MINUTES} minute(s))`
  );

  autoAcceptJobInterval = setInterval(async () => {
    try {
      await autoAcceptExpiredChecklists();
    } catch (error) {
      console.error("Checklist auto-accept job error:", error?.message || error);
    }
  }, intervalMs);
};

// ─── API 4: Confirm Checkout Checklist (Cleaner) ─────────────────

const confirmCheckoutChecklist = async (cleaningTaskId, cleanerId, itemsPayload) => {
  const cleaningTask = await CleaningTask.findOne({ id: cleaningTaskId }).lean();
  if (!cleaningTask) throw createError("Cleaning task not found", 404);

  const actorIds = [cleanerId];
  const user = await User.findOne(
    mongoose.Types.ObjectId.isValid(cleanerId)
      ? { $or: [{ id: cleanerId }, { _id: cleanerId }] }
      : { id: cleanerId }
  ).select("_id id").lean();

  if (user) {
    if (user._id) actorIds.push(String(user._id));
    if (user.id) actorIds.push(String(user.id));
  }

  if (!actorIds.includes(String(cleaningTask.cleaner_id))) {
    throw createError("You are not authorized to access this cleaning task", 403);
  }

  if (cleaningTask.status !== "IN_PROGRESS") {
    throw createError("Checkout checklist can only be confirmed for IN_PROGRESS cleaning task", 400);
  }

  const bookingId = cleaningTask.booking_id;
  if (!bookingId) {
    throw createError("This cleaning task is not associated with any booking", 400);
  }

  if (!Array.isArray(itemsPayload) || itemsPayload.length === 0) {
    throw createError("items is required and must be a non-empty array", 400);
  }

  // Check if checkout checklist is already completed
  const existingCheckout = await BookingChecklist.countDocuments({
    booking_id: bookingId,
    type: "CHECKOUT"
  });

  if (existingCheckout > 0) {
    throw createError("Checkout checklist has already been submitted for this booking", 409);
  }

  const podItems = await PodItem.find({ pod_id: cleaningTask.pod_id })
    .select("item_id expected_quantity")
    .lean();

  const itemIds = podItems.map((pi) => pi.item_id);
  const reusableItems = await Item.find({
    id: { $in: itemIds },
    item_type: "REUSABLE",
  })
    .select("id name unit_cost")
    .lean();

  const reusableItemById = new Map(
    reusableItems.map((item) => [String(item.id), item])
  );
  const podItemByItemId = new Map(
    podItems
      .filter((pi) => reusableItemById.has(String(pi.item_id)))
      .map((pi) => [String(pi.item_id), pi])
  );

  const VALID_STATUSES = ["MATCHED", "DAMAGED", "MISSING"];
  const now = new Date();
  const checklistDocs = [];
  const incidentItems = [];

  for (let i = 0; i < itemsPayload.length; i++) {
    const entry = itemsPayload[i];
    const itemId = String(entry?.item_id || "").trim();

    if (!itemId) {
      throw createError(`items[${i}].item_id is required`, 400);
    }

    const reusableItem = reusableItemById.get(itemId);
    if (!reusableItem) {
      throw createError(
        `items[${i}].item_id "${itemId}" is not a valid REUSABLE item in this pod`,
        400
      );
    }

    const status = String(entry?.status || "").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      throw createError(
        `items[${i}].status must be one of: ${VALID_STATUSES.join(", ")}`,
        400
      );
    }

    const podItem = podItemByItemId.get(itemId);
    const expectedQty = podItem ? podItem.expected_quantity : 0;
    const reportedQty =
      entry?.quantity !== undefined ? Number(entry.quantity) : expectedQty;

    if (reportedQty < 0 || reportedQty > expectedQty) {
      throw createError(
        `Số lượng báo cáo cho vật dụng "${reusableItem.name}" (${reportedQty}) không hợp lệ. Số lượng tối đa trong phòng là ${expectedQty}.`,
        400
      );
    }

    const doc = {
      booking_id: bookingId,
      pod_id: cleaningTask.pod_id,
      item_id: itemId,
      item_name: reusableItem.name,
      unit_cost: reusableItem.unit_cost || 0,
      type: "CHECKOUT",
      expected_quantity: expectedQty,
      reported_status: status,
      reported_quantity: reportedQty,
      incident_id: null,
      confirmed_by: "CLEANER",
      confirmed_at: now,
    };

    checklistDocs.push(doc);

    if (status === "DAMAGED" || status === "MISSING") {
      incidentItems.push({
        doc,
        index: i,
      });
    }
  }

  // Insert checklist records
  const created = await BookingChecklist.insertMany(checklistDocs, {
    ordered: false,
  });

  const createdMap = new Map(
    created.map((c) => [String(c.item_id), c])
  );

  // Create incidents for DAMAGED/MISSING items
  const createdIncidents = [];
  for (const { doc } of incidentItems) {
    const descParts = [];
    if (doc.reported_status === "DAMAGED") {
      descParts.push(`${doc.reported_quantity} ${doc.item_name} bị hư hỏng lúc check-out`);
    } else {
      descParts.push(`${doc.reported_quantity} ${doc.item_name} bị thiếu lúc check-out`);
    }
    descParts.push(`(Số lượng tiêu chuẩn của phòng: ${doc.expected_quantity})`);

    const estimatedValue = doc.unit_cost * doc.reported_quantity;

    const incident = await Incident.create({
      pod_id: doc.pod_id,
      incident_type: "DAMAGE_REPORT",
      booking_id: doc.booking_id,
      cleaning_task_id: cleaningTaskId,
      reported_by: cleanerId,
      description: descParts.join(" "),
      severity: "MEDIUM",
      status: "PENDING",
      estimated_total_value: estimatedValue > 0 ? estimatedValue : null,
    });

    // Create Incident Detail
    await IncidentDetail.create({
      incident_id: incident.id,
      type: "ITEM",
      item_id: doc.item_id,
      service_catalog_id: null,
      name_snapshot: doc.item_name,
      unit_cost_snapshot: doc.unit_cost,
      quantity: doc.reported_quantity,
      total_cost: estimatedValue,
      note: `Báo cáo qua Checkout Checklist`,
    });

    // Link incident to checklist record
    const checklistRecord = createdMap.get(String(doc.item_id));
    if (checklistRecord) {
      checklistRecord.incident_id = incident.id;
      await checklistRecord.save();
    }

    createdIncidents.push({
      incident_id: incident.id,
      item_name: doc.item_name,
      status: doc.reported_status,
      quantity: doc.reported_quantity,
    });
  }

  // Notify manager if there are issues
  if (createdIncidents.length > 0) {
    const pod = await Pod.findOne({ id: cleaningTask.pod_id }).select("id code name").lean();
    const podCode = pod?.code || pod?.name || cleaningTask.pod_id || "Unknown";

    // We can reuse the resolveManagersForPod logic from incidentService but it's not directly accessible here.
    // Instead we can just find all managers simply, or we import it. Since we are in bookingChecklistService, 
    // it's easier to just find all managers or a simple approach.
    const managerIds = await User.find({ role: "manager", isActive: true }).select("_id").lean();

    for (const manager of managerIds) {
      await notificationService.sendToUser(String(manager._id), {
        title: "Có báo cáo hư hại từ Cleaner",
        message: `Cleaner vừa gửi báo cáo hư hại lúc checkout cho Pod ${podCode}.`,
        type: "INCIDENT",
        event_code: "INCIDENT_REVIEW_REQUIRED",
        dedupe_key: `CHECKOUT_ISSUE_REPORTED:${bookingId}:${manager._id}`,
        data: {
          booking_id: bookingId,
          pod_id: cleaningTask.pod_id,
          pod_code: podCode,
          incident_count: String(createdIncidents.length),
        },
      }).catch(() => null);
    }
  }

  return {
    booking_id: bookingId,
    pod_id: cleaningTask.pod_id,
    total_items: checklistDocs.length,
    matched_count: checklistDocs.filter(
      (d) => d.reported_status === "MATCHED"
    ).length,
    issue_count: createdIncidents.length,
    incidents: createdIncidents,
    message:
      createdIncidents.length > 0
        ? `Checkout checklist hoàn tất. Đã báo cáo ${createdIncidents.length} sự cố.`
        : "Checkout checklist hoàn tất. Tất cả vật dụng đầy đủ và hoạt động tốt.",
  };
};

// ─── API 5: Get Checkout Checklist Items (Cleaner) ─────────────────

const getCheckoutChecklistItems = async (cleaningTaskId, cleanerId) => {
  const cleaningTask = await CleaningTask.findOne({ id: cleaningTaskId }).lean();
  if (!cleaningTask) throw createError("Cleaning task not found", 404);

  const actorIds = [cleanerId];
  const user = await User.findOne(
    mongoose.Types.ObjectId.isValid(cleanerId)
      ? { $or: [{ id: cleanerId }, { _id: cleanerId }] }
      : { id: cleanerId }
  ).select("_id id").lean();

  if (user) {
    if (user._id) actorIds.push(String(user._id));
    if (user.id) actorIds.push(String(user.id));
  }

  if (!actorIds.includes(String(cleaningTask.cleaner_id))) {
    throw createError("You are not authorized to access this cleaning task", 403);
  }

  const bookingId = cleaningTask.booking_id;
  if (!bookingId) {
    throw createError("This cleaning task is not associated with any booking", 400);
  }

  const podItems = await PodItem.find({ pod_id: cleaningTask.pod_id })
    .select("id pod_id item_id expected_quantity current_quantity")
    .lean();

  if (!podItems.length) {
    return {
      booking_id: bookingId,
      pod_id: cleaningTask.pod_id,
      items: [],
    };
  }

  const itemIds = podItems.map((pi) => pi.item_id);
  const items = await Item.find({
    id: { $in: itemIds },
    item_type: "REUSABLE",
  })
    .select("id name item_type")
    .lean();

  const itemById = new Map(items.map((item) => [String(item.id), item]));

  const checklistItems = podItems
    .filter((pi) => itemById.has(String(pi.item_id)))
    .map((pi) => {
      const item = itemById.get(String(pi.item_id));
      return {
        item_id: item.id,
        item_name: item.name,
        expected_quantity: pi.expected_quantity,
      };
    });

  // Get user's checkin records so cleaner knows what was reported initially
  const checkinRecords = await BookingChecklist.find({
    booking_id: bookingId,
    type: "CHECKIN",
  })
    .select("item_id reported_status reported_quantity")
    .lean();

  const checkinMap = new Map(
    checkinRecords.map((c) => [String(c.item_id), c])
  );

  const enrichedItems = checklistItems.map((item) => {
    const checkin = checkinMap.get(String(item.item_id));
    return {
      ...item,
      user_reported_status: checkin ? checkin.reported_status : null,
      user_reported_quantity: checkin ? checkin.reported_quantity : null,
    };
  });

  return {
    booking_id: bookingId,
    pod_id: cleaningTask.pod_id,
    items: enrichedItems,
  };
};

module.exports = {
  getChecklistItems,
  confirmChecklist,
  getChecklistStatus,
  autoAcceptExpiredChecklists,
  startAutoAcceptJob,
  confirmCheckoutChecklist,
  getCheckoutChecklistItems,
};
