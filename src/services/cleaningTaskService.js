const CleaningTask = require("../models/CleaningTask");
const CleaningPhoto = require("../models/CleaningPhoto");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Booking = require("../models/Bookings");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const StaffShift = require("../models/StaffShift");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const CleaningBufferPolicy = require("../models/CleaningBufferPolicy");
const Location = require("../models/Location");
const OnlineKey = require("../models/OnlineKey");
const notificationService = require("./notificationService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");
const BookingOrder = require("../models/BookingOrder");
const Incident = require("../models/Incidents");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const { randomInt } = require("crypto");

const CLEANING_TASK_STATUSES = [
  "ASSIGNED",
  "NOTIFIED",
  "ACCEPTED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "MISSED",
];

const REQUEST_SOURCES = ["USER_REQUEST", "AUTO_AFTER_CHECKOUT", "SYSTEM_RETRY"];
const ACTIVE_TASK_STATUSES = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS"];
const REFUND_BLOCKING_TASK_STATUSES = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS", "MISSED"];
const REFUND_TRIGGER_TERMINAL_STATUSES = ["DONE", "CANCELLED", "MISSED"];
const DEFAULT_CLEANING_BUFFER_MINUTES = 30;
const AUTO_AFTER_CHECKOUT_DUE_SPACING_MINUTES = 30;
const CLEANER_POST_CHECKOUT_WINDOW_MINUTES = 30;

const resolveOrderForTaskBooking = async (bookingId, session = null) => {
  if (!bookingId) return null;

  const bookingQuery = Booking.findOne({ id: String(bookingId) }).select("id order_id");
  const booking = session ? await bookingQuery.session(session).lean() : await bookingQuery.lean();
  if (!booking || !booking.order_id) return null;

  const orderQuery = BookingOrder.findOne({ id: String(booking.order_id) })
    .select("id user_id status deposit_total deposit_settlement_status");
  const order = session ? await orderQuery.session(session) : await orderQuery;
  if (!order) return null;

  return { booking, order };
};

const tryAutoRefundDepositAfterCleaningDone = async ({ bookingId }) => {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    console.warn("Auto refund skipped", {
      reason: "MISSING_BOOKING_ID",
      booking_id: bookingId || null,
    });
    return;
  }

  const resolved = await resolveOrderForTaskBooking(normalizedBookingId);
  if (!resolved) {
    console.warn("Auto refund skipped", {
      reason: "BOOKING_OR_ORDER_NOT_FOUND",
      booking_id: normalizedBookingId,
    });
    return;
  }

  const { order } = resolved;
  if (!["PAID", "PARTIAL_CANCEL"].includes(String(order.status || ""))) {
    console.warn("Auto refund skipped", {
      reason: "ORDER_STATUS_NOT_ELIGIBLE",
      booking_id: normalizedBookingId,
      order_id: String(order.id || ""),
      order_status: String(order.status || ""),
    });
    return;
  }
  if (String(order.deposit_settlement_status || "") !== "PENDING_INSPECTION") {
    console.warn("Auto refund skipped", {
      reason: "SETTLEMENT_STATUS_NOT_PENDING_INSPECTION",
      booking_id: normalizedBookingId,
      order_id: String(order.id || ""),
      deposit_settlement_status: String(order.deposit_settlement_status || ""),
    });
    return;
  }

  const depositAmount = Number(order.deposit_total || 0);
  if (depositAmount <= 0) {
    console.warn("Auto refund skipped", {
      reason: "DEPOSIT_AMOUNT_NOT_POSITIVE",
      booking_id: normalizedBookingId,
      order_id: String(order.id || ""),
      deposit_amount: depositAmount,
    });
    return;
  }

  let refundNotificationPayload = null;
  let pendingIncidentSettlementOrderId = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const freshResolved = await resolveOrderForTaskBooking(normalizedBookingId, session);
      if (!freshResolved) {
        console.warn("Auto refund skipped", {
          reason: "BOOKING_OR_ORDER_NOT_FOUND_IN_TX",
          booking_id: normalizedBookingId,
        });
        return;
      }

      const freshOrder = freshResolved.order;
      const freshDepositAmount = Number(freshOrder.deposit_total || 0);

      if (!["PAID", "PARTIAL_CANCEL"].includes(String(freshOrder.status || ""))) {
        console.warn("Auto refund skipped", {
          reason: "ORDER_STATUS_NOT_ELIGIBLE_IN_TX",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
          order_status: String(freshOrder.status || ""),
        });
        return;
      }
      if (String(freshOrder.deposit_settlement_status || "") !== "PENDING_INSPECTION") {
        console.warn("Auto refund skipped", {
          reason: "SETTLEMENT_STATUS_NOT_PENDING_INSPECTION_IN_TX",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
          deposit_settlement_status: String(freshOrder.deposit_settlement_status || ""),
        });
        return;
      }
      if (freshDepositAmount <= 0) {
        console.warn("Auto refund skipped", {
          reason: "DEPOSIT_AMOUNT_NOT_POSITIVE_IN_TX",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
          deposit_amount: freshDepositAmount,
        });
        return;
      }

      const orderBookings = await Booking.find({
        order_id: freshOrder.id,
        status: { $ne: "CANCELLED" },
      })
        .select("id")
        .session(session)
        .lean();

      if (!orderBookings.length) {
        console.warn("Auto refund skipped", {
          reason: "NO_ACTIVE_BOOKING_IN_ORDER",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
        });
        return;
      }

      const orderBookingIds = orderBookings.map((item) => item.id);

      const unfinishedTask = await CleaningTask.findOne({
        booking_id: { $in: orderBookingIds },
        status: { $in: REFUND_BLOCKING_TASK_STATUSES },
      })
        .select("id status booking_id")
        .session(session)
        .lean();

      if (unfinishedTask) {
        console.warn("Auto refund skipped", {
          reason: "UNFINISHED_CLEANING_TASK_EXISTS",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
          task_id: String(unfinishedTask.id || ""),
          task_status: String(unfinishedTask.status || ""),
          task_booking_id: String(unfinishedTask.booking_id || ""),
        });
        return;
      }

      const hasIncident = await Incident.exists({
        booking_id: { $in: orderBookingIds },
      }).session(session);

      if (hasIncident) {
        pendingIncidentSettlementOrderId = String(freshOrder.id || "");
        console.warn("Auto refund skipped", {
          reason: "INCIDENT_EXISTS_BLOCKING_REFUND",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
        });
        return;
      }

      const settlementUpdate = await BookingOrder.updateOne(
        {
          id: freshOrder.id,
          deposit_settlement_status: "PENDING_INSPECTION",
          deposit_total: { $gt: 0 },
        },
        {
          $set: {
            deposit_settlement_status: "REFUNDED",
          },
        },
        { session }
      );

      if (settlementUpdate.modifiedCount !== 1) {
        console.warn("Auto refund skipped", {
          reason: "SETTLEMENT_UPDATE_NOT_MODIFIED",
          booking_id: normalizedBookingId,
          order_id: String(freshOrder.id || ""),
          modified_count: Number(settlementUpdate.modifiedCount || 0),
        });
        return;
      }

      let wallet = await Wallet.findOne({ user_id: freshOrder.user_id }).session(session);
      if (!wallet) {
        const createdWallet = await Wallet.create(
          [
            {
              user_id: freshOrder.user_id,
              balance: 0,
              status: "ACTIVE",
            },
          ],
          { session }
        );
        wallet = createdWallet[0];
      }

      const balanceBefore = Number(wallet.balance || 0);
      const balanceAfter = Number((balanceBefore + freshDepositAmount).toFixed(2));
      wallet.balance = balanceAfter;
      await wallet.save({ session });

      const createdRefundTx = await Transaction.create(
        [
          {
            order_id: freshOrder.id,
            amount: freshDepositAmount,
            currency: "VND",
            type: "REFUND",
            method: "WALLET",
            status: "SUCCESS",
            provider_reference: "AUTO_REFUND_DEPOSIT_CLEANING_DONE",
          },
        ],
        { session }
      );

      const refundTx = createdRefundTx[0];

      await WalletTransaction.create(
        [
          {
            wallet_id: wallet.id,
            amount: freshDepositAmount,
            type: "REFUND",
            transaction_id: refundTx.id,
            reference_id: freshOrder.id,
            description: `Hoan tien coc don ${freshOrder.id} sau khi cleaner hoan tat va khong co su co`,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
          },
        ],
        { session }
      );

      refundNotificationPayload = {
        user_id: String(freshOrder.user_id || ""),
        order_id: String(freshOrder.id || ""),
        deposit_amount: freshDepositAmount,
        refunded_transaction_id: String(refundTx.id || ""),
      };
    });

    if (refundNotificationPayload && refundNotificationPayload.user_id) {
      await notificationService.sendToUser(refundNotificationPayload.user_id, {
        title: "Hoan tien coc thanh cong",
        message: `He thong da hoan ${Number(refundNotificationPayload.deposit_amount || 0).toLocaleString("vi-VN")} VND tien coc vao vi cua ban.`,
        type: "PAYMENT",
        event_code: "PAYMENT_DEPOSIT_REFUND_SUCCESS",
        dedupe_key: `PAYMENT_DEPOSIT_REFUND_SUCCESS:${refundNotificationPayload.order_id}:${refundNotificationPayload.refunded_transaction_id || "NO_TX"}`,
        data: {
          type: "PAYMENT_DEPOSIT_REFUND_SUCCESS",
          order_id: refundNotificationPayload.order_id,
          refund_amount: String(refundNotificationPayload.deposit_amount || 0),
          deposit_amount: String(refundNotificationPayload.deposit_amount || 0),
          refunded_transaction_id: refundNotificationPayload.refunded_transaction_id,
          refunded_to_wallet_immediately: "true",
        },
      });
    }

    if (pendingIncidentSettlementOrderId) {
      const incidentService = require("./incidentService");
      await incidentService.settleOrderDepositAfterIncidents({
        orderId: pendingIncidentSettlementOrderId,
        trigger: "CLEANING_DONE_WITH_INCIDENTS",
      });
    }
  } finally {
    await session.endSession();
  }
};

const createError = (message, statusCode, errorCode = null) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (errorCode) err.errorCode = errorCode;
  return err;
};

const generateUniqueOnlineKeyToken = async () => {
  const MAX_RETRY = 10;

  for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
    const token = String(randomInt(0, 1000000)).padStart(6, "0");
    const exists = await OnlineKey.exists({ key_token: token, is_revoked: false });
    if (!exists) return token;
  }

  throw createError("Unable to generate unique online key token", 500);
};

const buildUserIdentityQuery = (identity) => {
  const normalizedIdentity = String(identity || "").trim();
  if (!normalizedIdentity) {
    return null;
  }

  const orQuery = [{ id: normalizedIdentity }];
  if (mongoose.Types.ObjectId.isValid(normalizedIdentity)) {
    orQuery.push({ _id: new mongoose.Types.ObjectId(normalizedIdentity) });
  }

  return { $or: orQuery };
};

const resolveActorCleanerIds = (actor) => {
  return [actor?.id, actor?._id]
    .filter(Boolean)
    .map((value) => String(value));
};

const normalizeStatus = (status) => {
  if (status === undefined || status === null) return status;
  return String(status).trim().toUpperCase();
};

const validateStatus = (status) => {
  if (status && !CLEANING_TASK_STATUSES.includes(status)) {
    throw createError(`Invalid status. Must be one of: ${CLEANING_TASK_STATUSES.join(", ")}`, 400);
  }
};

const normalizeRequestSource = (source) => {
  if (source === undefined || source === null) return source;
  return String(source).trim().toUpperCase();
};

const validateRequestSource = (source) => {
  if (source && !REQUEST_SOURCES.includes(source)) {
    throw createError(`Invalid request_source. Must be one of: ${REQUEST_SOURCES.join(", ")}`, 400);
  }
};

const getDateRangeForDay = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw createError("Invalid booking date for cleaning task assignment", 400);
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return { startOfDay, endOfDay };
};

const getPreferredTaskTime = (booking) => {
  if (booking && booking.actual_end_time) return booking.actual_end_time;
  if (booking && booking.end_time) return booking.end_time;
  if (booking && booking.start_time) return booking.start_time;
  return new Date();
};

const resolveCleaningBufferMinutes = async ({ podId, clusterId, locationId }) => {
  const podPolicy = podId
    ? await CleaningBufferPolicy.findOne({ pod_id: String(podId), is_active: true })
      .sort({ created_at: -1 })
      .select("id buffer_minutes")
      .lean()
    : null;

  if (podPolicy && Number.isInteger(Number(podPolicy.buffer_minutes))) {
    return {
      bufferMinutes: Number(podPolicy.buffer_minutes),
      source: "POD",
      policyId: podPolicy.id,
    };
  }

  const clusterPolicy = clusterId
    ? await CleaningBufferPolicy.findOne({ cluster_id: String(clusterId), is_active: true })
      .sort({ created_at: -1 })
      .select("id buffer_minutes")
      .lean()
    : null;

  if (clusterPolicy && Number.isInteger(Number(clusterPolicy.buffer_minutes))) {
    return {
      bufferMinutes: Number(clusterPolicy.buffer_minutes),
      source: "CLUSTER",
      policyId: clusterPolicy.id,
    };
  }

  const locationPolicy = locationId
    ? await CleaningBufferPolicy.findOne({ location_id: String(locationId), is_active: true })
      .sort({ created_at: -1 })
      .select("id buffer_minutes")
      .lean()
    : null;

  if (locationPolicy && Number.isInteger(Number(locationPolicy.buffer_minutes))) {
    return {
      bufferMinutes: Number(locationPolicy.buffer_minutes),
      source: "LOCATION",
      policyId: locationPolicy.id,
    };
  }

  return {
    bufferMinutes: DEFAULT_CLEANING_BUFFER_MINUTES,
    source: "DEFAULT",
    policyId: null,
  };
};

const getDueTimeWithMinutes = (booking, fallbackTime, bufferMinutes) => {
  const baseTime = booking && booking.actual_end_time
    ? new Date(booking.actual_end_time)
    : booking && booking.end_time
      ? new Date(booking.end_time)
      : new Date(fallbackTime);
  if (Number.isNaN(baseTime.getTime())) {
    return new Date();
  }

  return new Date(baseTime.getTime() + Number(bufferMinutes) * 60 * 1000);
};

const TRIGGER_REQUEST_SOURCE_RULES = Object.freeze({
  BOOKING_ORDER_CREATED: "AUTO_AFTER_CHECKOUT",
  BOOKING_CREATED: "AUTO_AFTER_CHECKOUT",
  SYSTEM_RETRY_BACKFILL: "SYSTEM_RETRY",
});

const getRequestSourceByTrigger = (trigger = "", bookingLike = null) => {
  const normalized = String(trigger || "").toUpperCase();
  const bookingStatus = String(bookingLike?.status || "").toUpperCase();
  const checkinState = String(bookingLike?.checkin_state || "").toUpperCase();

  if (
    normalized === "BOOKING_UPDATED_CLEANER_ACCESS_TRUE" ||
    normalized === "SET_CLEANER_ACCESS_TRUE"
  ) {
    if (bookingStatus === "IN_USE" && checkinState !== "NO_SHOW") {
      return "USER_REQUEST";
    }

    return "AUTO_AFTER_CHECKOUT";
  }

  if (TRIGGER_REQUEST_SOURCE_RULES[normalized]) {
    return TRIGGER_REQUEST_SOURCE_RULES[normalized];
  }

  if (normalized.includes("RETRY")) {
    return "SYSTEM_RETRY";
  }

  // Reserve USER_REQUEST for explicit user-driven trigger names.
  if (normalized.includes("USER_REQUEST") || normalized.includes("INTERIM_CLEANING")) {
    return "USER_REQUEST";
  }

  // Unknown/legacy system triggers default to turnover flow.
  return "AUTO_AFTER_CHECKOUT";
};

const applyStatusAuditFields = (taskPayload, previousStatus = null) => {
  const nextStatus = normalizeStatus(taskPayload.status);
  if (!nextStatus || nextStatus === previousStatus) {
    return;
  }

  const now = new Date();

  if (nextStatus === "ASSIGNED" && !taskPayload.assigned_at) {
    taskPayload.assigned_at = now;
  }

  if (nextStatus === "NOTIFIED" && !taskPayload.notified_at) {
    taskPayload.notified_at = now;
  }

  if (nextStatus === "ACCEPTED" && !taskPayload.accepted_at) {
    taskPayload.accepted_at = now;
  }

  if (nextStatus === "IN_PROGRESS" && !taskPayload.start_time) {
    taskPayload.start_time = now;
  }

  if (nextStatus === "DONE" && !taskPayload.end_time) {
    taskPayload.end_time = now;
  }
};

const applyDueRangeFilter = (filter, query = {}) => {
  const dueAtFilter = {};
  if (query.due_from) {
    const dueFrom = new Date(query.due_from);
    if (Number.isNaN(dueFrom.getTime())) {
      throw createError("due_from must be a valid date", 400);
    }
    dueAtFilter.$gte = dueFrom;
  }

  if (query.due_to) {
    const dueTo = new Date(query.due_to);
    if (Number.isNaN(dueTo.getTime())) {
      throw createError("due_to must be a valid date", 400);
    }
    dueAtFilter.$lte = dueTo;
  }

  if (Object.keys(dueAtFilter).length > 0) {
    filter.due_at = dueAtFilter;
  }
};

const formatDateTimeVi = (value) => {
  if (!value) return "Khong xac dinh";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Khong xac dinh";

  return date.toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const resolveNotificationUserId = async (identity) => {
  const query = buildUserIdentityQuery(identity);
  if (!query) return null;

  const user = await User.findOne(query).select("_id").lean();
  if (!user || !user._id) return null;

  return String(user._id);
};

const resolvePodContext = async (podId) => {
  const pod = await Pod.findOne({ id: String(podId) }).select("id code cluster_id").lean();
  if (!pod) return { podCode: String(podId || "Unknown"), locationName: "Unknown" };

  const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id").lean();
  if (!cluster || !cluster.location_id) {
    return { podCode: pod.code || pod.id || "Unknown", locationName: "Unknown" };
  }

  const location = await Location.findOne({ id: cluster.location_id }).select("id name").lean();

  return {
    podCode: pod.code || pod.id || "Unknown",
    locationName: location?.name || "Unknown",
  };
};

const notifyCleanerTaskAssigned = async (task, options = {}) => {
  if (!task || !task.cleaner_id || !task.pod_id) return;

  const cleanerUserId = await resolveNotificationUserId(task.cleaner_id);
  if (!cleanerUserId) return;

  const { podCode, locationName } = await resolvePodContext(task.pod_id);
  const dueAtText = formatDateTimeVi(task.due_at);
  const dedupeSuffix = options.dedupeSuffix ? `:${String(options.dedupeSuffix)}` : "";

  await notificationService.sendToUser(cleanerUserId, {
    title: `Nhiem vu moi: Ve sinh Pod ${podCode}`,
    message: `Nhiem vu moi: Ve sinh Pod ${podCode} tai ${locationName}. Han chot: ${dueAtText}.`,
    type: "CLEANING",
    event_code: "CLEANING_TASK_ASSIGNED",
    dedupe_key: `CLEANING_TASK_ASSIGNED:${String(task.id)}:${cleanerUserId}${dedupeSuffix}`,
    data: {
      cleaning_task_id: String(task.id),
      booking_id: task.booking_id ? String(task.booking_id) : null,
      pod_id: String(task.pod_id),
      pod_code: podCode,
      location_name: locationName,
      due_at: task.due_at || null,
    },
  });

  emitCleanerNotificationEvent({
    user_id: cleanerUserId,
    notification: {
      event: "CLEANING_TASK_ASSIGNED",
      payload: {
        cleaning_task_id: String(task.id),
        booking_id: task.booking_id ? String(task.booking_id) : null,
        pod_id: String(task.pod_id),
        pod_code: podCode,
        location_name: locationName,
        due_at: task.due_at || null,
        title: `Nhiem vu moi: Ve sinh Pod ${podCode}`,
        message: `Nhiem vu moi: Ve sinh Pod ${podCode} tai ${locationName}. Han chot: ${dueAtText}.`,
      },
    },
  });
};

const emitCleaningTaskStatusChangedRealtime = async ({
  task,
  previousStatus,
  previousCleanerId = null,
}) => {
  if (!task) return;

  const nextStatus = String(task.status || "");
  const prevStatus = String(previousStatus || "");
  if (!nextStatus || nextStatus === prevStatus) {
    return;
  }

  const cleanerCandidates = [
    previousCleanerId,
    task.cleaner_id,
  ]
    .filter(Boolean)
    .map((value) => String(value));

  const uniqueCleanerIds = [...new Set(cleanerCandidates)];
  if (uniqueCleanerIds.length === 0) {
    return;
  }

  const cleanerUserIds = await Promise.all(uniqueCleanerIds.map((identity) => resolveNotificationUserId(identity)));

  cleanerUserIds
    .filter(Boolean)
    .forEach((userId) => {
      emitCleanerNotificationEvent({
        user_id: userId,
        notification: {
          event: "CLEANING_TASK_STATUS_CHANGED",
          payload: {
            cleaning_task_id: String(task.id),
            booking_id: task.booking_id ? String(task.booking_id) : null,
            pod_id: task.pod_id ? String(task.pod_id) : null,
            cleaner_id: task.cleaner_id ? String(task.cleaner_id) : null,
            previous_status: prevStatus || null,
            status: nextStatus,
            note: task.note || null,
            rejection_reason: task.rejection_reason || null,
            updated_at: new Date().toISOString(),
          },
        },
      });
    });
};

const selectAssignmentWithLoadBalancing = async (assignments = [], eligibleCleanerIds = [], options = {}) => {
  if (!Array.isArray(assignments) || assignments.length === 0) return null;
  if (!Array.isArray(eligibleCleanerIds) || eligibleCleanerIds.length === 0) return null;

  const requestSource = String(options.requestSource || "").toUpperCase();
  const dueAtInput = options.dueAt ? new Date(options.dueAt) : null;
  const shouldApplyDueSpacingRule =
    requestSource === "AUTO_AFTER_CHECKOUT" && dueAtInput && !Number.isNaN(dueAtInput.getTime());

  const cleanerIdSet = new Set(eligibleCleanerIds.map((id) => String(id)));
  const checkedInAssignments = assignments.filter(
    (item) => item.status === "CHECKED_IN" && cleanerIdSet.has(String(item.staff_id))
  );

  const fallbackAssignments = assignments.filter((item) => cleanerIdSet.has(String(item.staff_id)));
  const candidateAssignments = checkedInAssignments.length > 0 ? checkedInAssignments : fallbackAssignments;

  if (candidateAssignments.length === 0) {
    return null;
  }

  const candidateCleanerIds = [...new Set(candidateAssignments.map((item) => String(item.staff_id)))];

  const counts = await CleaningTask.aggregate([
    {
      $match: {
        cleaner_id: { $in: candidateCleanerIds },
        status: { $in: ACTIVE_TASK_STATUSES },
      },
    },
    {
      $group: {
        _id: "$cleaner_id",
        total: { $sum: 1 },
      },
    },
  ]);

  const countMap = new Map(counts.map((item) => [String(item._id), Number(item.total) || 0]));

  let prioritizedAssignments = candidateAssignments;

  if (shouldApplyDueSpacingRule) {
    const spacingMs = AUTO_AFTER_CHECKOUT_DUE_SPACING_MINUTES * 60 * 1000;
    const windowStart = new Date(dueAtInput.getTime() - spacingMs);
    const windowEnd = new Date(dueAtInput.getTime() + spacingMs);

    const conflicts = await CleaningTask.aggregate([
      {
        $match: {
          cleaner_id: { $in: candidateCleanerIds },
          request_source: "AUTO_AFTER_CHECKOUT",
          status: { $in: ACTIVE_TASK_STATUSES },
          due_at: { $gte: windowStart, $lte: windowEnd },
        },
      },
      {
        $group: {
          _id: "$cleaner_id",
          total: { $sum: 1 },
        },
      },
    ]);

    const conflictCleanerIds = new Set(conflicts.map((item) => String(item._id)));
    const nonConflictAssignments = candidateAssignments.filter(
      (item) => !conflictCleanerIds.has(String(item.staff_id))
    );

    // Prefer cleaners with no AUTO_AFTER_CHECKOUT due-time conflict in +/- 30 minutes.
    // If everyone conflicts, fallback to load balancing on all candidates.
    if (nonConflictAssignments.length > 0) {
      prioritizedAssignments = nonConflictAssignments;
    }
  }

  let selected = null;
  let minLoad = Number.MAX_SAFE_INTEGER;

  for (const assignment of prioritizedAssignments) {
    const cleanerId = String(assignment.staff_id);
    const load = countMap.has(cleanerId) ? countMap.get(cleanerId) : 0;

    if (load < minLoad) {
      minLoad = load;
      selected = assignment;
      continue;
    }

    if (load === minLoad && selected) {
      const currentCheckIn = assignment.checkin_at ? new Date(assignment.checkin_at).getTime() : 0;
      const selectedCheckIn = selected.checkin_at ? new Date(selected.checkin_at).getTime() : 0;
      if (currentCheckIn > selectedCheckIn) {
        selected = assignment;
      }
    }
  }

  return selected;
};

const withDebug = (payload, debugInfo, includeDebug) => {
  if (!includeDebug) return payload;
  return {
    ...payload,
    debug: debugInfo,
  };
};

const getCleanerIdentity = (user) => {
  if (!user) return null;
  if (user.id !== undefined && user.id !== null && String(user.id).trim() !== "") return String(user.id);
  if (user._id !== undefined && user._id !== null && String(user._id).trim() !== "") return String(user._id);
  return null;
};

const isCleanerCheckedInAtLocation = async (cleanerId, locationId, referenceTime = new Date()) => {
  const normalizedCleanerId = String(cleanerId || "").trim();
  const normalizedLocationId = String(locationId || "").trim();

  if (!normalizedCleanerId || !normalizedLocationId) {
    return false;
  }

  const locationShifts = await LocationShift.find({ location_id: normalizedLocationId })
    .select("id")
    .lean();

  const locationShiftIds = locationShifts.map((item) => item.id);
  if (locationShiftIds.length === 0) {
    return false;
  }

  const assignments = await StaffShiftAssignment.find({
    staff_id: normalizedCleanerId,
    location_shift_id: { $in: locationShiftIds },
    start_date: { $lte: referenceTime },
    end_date: { $gte: referenceTime },
  })
    .select("id status")
    .lean();

  if (assignments.length === 0) {
    return false;
  }

  if (assignments.some((item) => String(item.status || "").toUpperCase() === "CHECKED_IN")) {
    return true;
  }

  const assignmentIds = assignments.map((item) => item.id);
  const attendanceLogs = await StaffAttendanceLog.find({
    shift_assignment_id: { $in: assignmentIds },
  })
    .sort({ created_at: -1 })
    .select("shift_assignment_id action")
    .lean();

  const latestActionByAssignment = new Map();
  for (const log of attendanceLogs) {
    const key = String(log.shift_assignment_id);
    if (!latestActionByAssignment.has(key)) {
      latestActionByAssignment.set(key, String(log.action || "").toUpperCase());
    }
  }

  for (const assignmentId of assignmentIds) {
    if (latestActionByAssignment.get(String(assignmentId)) === "CHECKIN") {
      return true;
    }
  }

  return false;
};

const getInitialAutoAssignStatus = (bookingLike, trigger = "") => {
  const normalizedTrigger = String(trigger || "").toUpperCase();
  const bookingStatus = String(bookingLike?.status || "").toUpperCase();

  if (
    normalizedTrigger === "SET_CLEANER_ACCESS_TRUE" ||
    normalizedTrigger === "BOOKING_UPDATED_CLEANER_ACCESS_TRUE" ||
    bookingStatus === "IN_USE"
  ) {
    return "NOTIFIED";
  }

  return "ASSIGNED";
};

const getCleaningTaskActionLabel = (status) => {
  const normalizedStatus = String(status || "").toUpperCase();

  if (normalizedStatus === "ASSIGNED" || normalizedStatus === "NOTIFIED") {
    return "Nhận nhiệm vụ dọn dẹp";
  }

  if (normalizedStatus === "ACCEPTED") {
    return "Bắt đầu dọn";
  }

  if (normalizedStatus === "IN_PROGRESS") {
    return "Tiếp tục dọn dẹp";
  }

  if (normalizedStatus === "DONE") {
    return "Đã hoàn tất dọn dẹp";
  }

  return null;
};

const CANCELLABLE_TASK_STATUSES_FOR_NO_SHOW = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS"];

const cancelOpenTasksForNoShowBooking = async (bookingId) => {
  if (!bookingId) return 0;

  const openTasks = await CleaningTask.find({
    booking_id: String(bookingId),
    status: { $in: CANCELLABLE_TASK_STATUSES_FOR_NO_SHOW },
  })
    .select("id booking_id pod_id cleaner_id")
    .lean();

  if (openTasks.length === 0) {
    return 0;
  }

  let cancelledCount = 0;

  for (const task of openTasks) {
    const updated = await CleaningTask.updateOne(
      {
        id: String(task.id),
        status: { $in: CANCELLABLE_TASK_STATUSES_FOR_NO_SHOW },
      },
      {
        $set: {
          status: "CANCELLED",
        },
      }
    );

    if (Number(updated?.modifiedCount || 0) !== 1) {
      continue;
    }

    cancelledCount += 1;

    const cleanerUserId = await resolveNotificationUserId(task.cleaner_id);
    if (!cleanerUserId) {
      continue;
    }

    const { podCode } = await resolvePodContext(task.pod_id);

    await notificationService.sendToUser(cleanerUserId, {
      title: `Nhiem vu da huy: Pod ${podCode}`,
      message: `Nhiem vu ve sinh Pod ${podCode} da duoc huy vi booking NO_SHOW.`,
      type: "CLEANING",
      event_code: "CLEANING_TASK_CANCELLED_NO_SHOW",
      dedupe_key: `CLEANING_TASK_CANCELLED_NO_SHOW:${String(task.id)}:${cleanerUserId}`,
      data: {
        cleaning_task_id: String(task.id),
        booking_id: String(task.booking_id || bookingId),
        pod_id: String(task.pod_id || ""),
        pod_code: podCode,
        cancelled_reason: "BOOKING_NO_SHOW",
      },
    });

    emitCleanerNotificationEvent({
      user_id: cleanerUserId,
      notification: {
        event: "CLEANING_TASK_CANCELLED_NO_SHOW",
        payload: {
          cleaning_task_id: String(task.id),
          booking_id: String(task.booking_id || bookingId),
          pod_id: String(task.pod_id || ""),
          pod_code: podCode,
          cancelled_reason: "BOOKING_NO_SHOW",
          title: `Nhiem vu da huy: Pod ${podCode}`,
          message: `Nhiem vu ve sinh Pod ${podCode} da duoc huy vi booking NO_SHOW.`,
        },
      },
    });
  }

  return cancelledCount;
};

exports.autoAssignTaskForBooking = async (bookingLike, options = {}) => {
  const includeDebug = options.include_debug === true;
  const dryRun = options.dry_run === true;
  const trigger = options.trigger || "UNKNOWN";
  const normalizedTrigger = String(trigger || "").toUpperCase();

  const debugInfo = {
    trigger: options.trigger || "UNKNOWN",
    booking_id: bookingLike && bookingLike.id ? String(bookingLike.id) : null,
    pod_id: bookingLike && bookingLike.pod_id ? String(bookingLike.pod_id) : null,
    task_reference_time: null,
    day_window: null,
    location_shift_count: 0,
    cleaner_shift_count: 0,
    cleaner_location_shift_count: 0,
    assignment_count: 0,
    total_cleaner_count: 0,
    available_cleaner_count: 0,
    buffer_minutes_applied: DEFAULT_CLEANING_BUFFER_MINUTES,
    buffer_policy_source: "DEFAULT",
    buffer_policy_id: null,
    cleaner_diagnostics: [],
    selected_assignment_id: null,
    selected_cleaner_id: null,
    skip_reason: null,
  };

  const bookingId = bookingLike && bookingLike.id ? String(bookingLike.id) : null;
  const podId = bookingLike && bookingLike.pod_id ? String(bookingLike.pod_id) : null;

  if (!bookingId || !podId) {
    throw createError("booking id and pod_id are required for auto assignment", 400);
  }

  const bookingCheckinState = bookingLike && bookingLike.checkin_state
    ? String(bookingLike.checkin_state).toUpperCase()
    : null;
  const bookingStatus = String(bookingLike?.status || "").toUpperCase();

  if (normalizedTrigger === "BOOKING_ORDER_CHECKOUT") {
    debugInfo.skip_reason = "CHECKOUT_AUTO_ASSIGN_DISABLED";
    return withDebug(
      {
        created: false,
        reason: "CHECKOUT_AUTO_ASSIGN_DISABLED",
        booking_id: bookingId,
      },
      debugInfo,
      includeDebug
    );
  }

  if (
    (normalizedTrigger === "SET_CLEANER_ACCESS_TRUE" ||
      normalizedTrigger === "BOOKING_UPDATED_CLEANER_ACCESS_TRUE") &&
    bookingStatus !== "IN_USE"
  ) {
    debugInfo.skip_reason = "USER_REQUEST_ONLY_IN_USE";
    return withDebug(
      {
        created: false,
        reason: "USER_REQUEST_ONLY_IN_USE",
        booking_id: bookingId,
      },
      debugInfo,
      includeDebug
    );
  }

  if (bookingCheckinState === "NO_SHOW") {
    debugInfo.skip_reason = "NO_SHOW_BLOCKED";
    const cancelled_task_count = dryRun ? 0 : await cancelOpenTasksForNoShowBooking(bookingId);
    return withDebug(
      {
        created: false,
        reason: "NO_SHOW_BLOCKED",
        booking_id: bookingId,
        cancelled_task_count,
      },
      debugInfo,
      includeDebug
    );
  }

  if (!bookingCheckinState) {
    const latestBooking = await Booking.findOne({ id: bookingId }).select("id checkin_state").lean();
    if (latestBooking && String(latestBooking.checkin_state || "").toUpperCase() === "NO_SHOW") {
      debugInfo.skip_reason = "NO_SHOW_BLOCKED";
      const cancelled_task_count = dryRun ? 0 : await cancelOpenTasksForNoShowBooking(bookingId);
      return withDebug(
        {
          created: false,
          reason: "NO_SHOW_BLOCKED",
          booking_id: bookingId,
          cancelled_task_count,
        },
        debugInfo,
        includeDebug
      );
    }
  }

  // Resolve request_source early so the dedup guard can be scoped by task type.
  // "Turnover" tasks (AUTO_AFTER_CHECKOUT, SYSTEM_RETRY) share a dedup group:
  //   only one should be active at a time per booking.
  // "Interim" tasks (USER_REQUEST) are scoped independently:
  //   they should not be blocked by a turnover task or block one.
  const requestSource = getRequestSourceByTrigger(trigger, bookingLike);

  // Dedup guard: skip creation if an active task of the same group already exists
  // for this booking. This prevents double-assign when multiple triggers fire
  // (e.g. repeated BOOKING_ORDER_CREATED calls, or repeated
  // SET_CLEANER_ACCESS_TRUE calls).
  if (!dryRun) {
    const TURNOVER_SOURCES = ["AUTO_AFTER_CHECKOUT", "SYSTEM_RETRY"];
    const dedupSources = TURNOVER_SOURCES.includes(requestSource)
      ? TURNOVER_SOURCES
      : [requestSource];

    const existingActiveTask = await CleaningTask.findOne({
      booking_id: bookingId,
      request_source: { $in: dedupSources },
      status: { $in: ACTIVE_TASK_STATUSES },
    })
      .select("id status request_source")
      .lean();

    if (existingActiveTask) {
      debugInfo.skip_reason = "ACTIVE_TASK_EXISTS";
      return withDebug(
        {
          created: false,
          reason: "ACTIVE_TASK_EXISTS",
          booking_id: bookingId,
          existing_task_id: existingActiveTask.id,
          existing_task_status: existingActiveTask.status,
          existing_task_source: existingActiveTask.request_source,
        },
        debugInfo,
        includeDebug
      );
    }
  }

  const taskReferenceTime = getPreferredTaskTime(bookingLike);
  const { startOfDay, endOfDay } = getDateRangeForDay(taskReferenceTime);
  debugInfo.task_reference_time = taskReferenceTime;
  debugInfo.day_window = { start_of_day: startOfDay, end_of_day: endOfDay };

  const pod = await Pod.findOne({ id: podId }).select("id cluster_id").lean();
  if (!pod) {
    debugInfo.skip_reason = "POD_NOT_FOUND";
    return withDebug({ created: false, reason: "POD_NOT_FOUND", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id").lean();
  if (!cluster || !cluster.location_id) {
    debugInfo.skip_reason = "LOCATION_NOT_FOUND";
    return withDebug({ created: false, reason: "LOCATION_NOT_FOUND", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const locationShifts = await LocationShift.find({ location_id: cluster.location_id }).select("id shift_id").lean();
  debugInfo.location_shift_count = locationShifts.length;
  if (locationShifts.length === 0) {
    debugInfo.skip_reason = "NO_LOCATION_SHIFT";
    return withDebug({ created: false, reason: "NO_LOCATION_SHIFT", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const shiftIds = [...new Set(locationShifts.map((item) => item.shift_id).filter(Boolean))];
  if (shiftIds.length === 0) {
    return { created: false, reason: "NO_SHIFT_LINKED", booking_id: bookingId };
  }

  const cleanerShifts = await StaffShift.find({
    id: { $in: shiftIds },
    role: "CLEANER",
    is_active: true,
  })
    .select("id")
    .lean();
  debugInfo.cleaner_shift_count = cleanerShifts.length;

  if (cleanerShifts.length === 0) {
    debugInfo.skip_reason = "NO_CLEANER_SHIFT";
    return withDebug({ created: false, reason: "NO_CLEANER_SHIFT", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const cleanerShiftIdSet = new Set(cleanerShifts.map((item) => item.id));
  const cleanerLocationShiftIds = locationShifts
    .filter((item) => cleanerShiftIdSet.has(item.shift_id))
    .map((item) => item.id);
  debugInfo.cleaner_location_shift_count = cleanerLocationShiftIds.length;

  if (cleanerLocationShiftIds.length === 0) {
    debugInfo.skip_reason = "NO_CLEANER_LOCATION_SHIFT";
    return withDebug({ created: false, reason: "NO_CLEANER_LOCATION_SHIFT", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const bufferConfig = await resolveCleaningBufferMinutes({
    podId,
    clusterId: cluster.id,
    locationId: cluster.location_id,
  });
  debugInfo.buffer_minutes_applied = bufferConfig.bufferMinutes;
  debugInfo.buffer_policy_source = bufferConfig.source;
  debugInfo.buffer_policy_id = bufferConfig.policyId;

  const dueAt = getDueTimeWithMinutes(bookingLike, taskReferenceTime, bufferConfig.bufferMinutes);

  // estimated_start_time = booking.end_time + 5 minutes
  const estimatedStartTime = bookingLike && bookingLike.end_time
    ? new Date(new Date(bookingLike.end_time).getTime() + 5 * 60 * 1000)
    : null;

  let allSystemCleaners = [];
  if (includeDebug) {
    allSystemCleaners = await User.find({ role: "cleaner" })
      .select("_id id name email isActive")
      .lean();
    debugInfo.total_cleaner_count = allSystemCleaners.length;
  }

  const assignments = await StaffShiftAssignment.find({
    location_shift_id: { $in: cleanerLocationShiftIds },
    // Support both legacy work_date records and current start_date/end_date range records.
    $or: [
      { work_date: { $gte: startOfDay, $lte: endOfDay } },
      {
        $and: [
          { start_date: { $lte: endOfDay } },
          { end_date: { $gte: startOfDay } },
        ],
      },
    ],
    status: { $in: ["CHECKED_IN", "ASSIGNED"] },
  })
    .sort({ created_at: 1 })
    .select("id staff_id status checkin_at")
    .lean();
  debugInfo.assignment_count = assignments.length;

  if (assignments.length === 0) {
    if (includeDebug) {
      debugInfo.cleaner_diagnostics = allSystemCleaners
        .map((cleaner) => {
          const cleanerIdentity = getCleanerIdentity(cleaner);
          if (!cleanerIdentity) return null;
          return {
            cleaner_id: cleanerIdentity,
            name: cleaner.name || null,
            email: cleaner.email || null,
            is_active: Boolean(cleaner.isActive),
            has_assignment_in_day: false,
            assignment_statuses: [],
            eligible: false,
            selected: false,
            reason: cleaner.isActive ? "NO_ASSIGNMENT_IN_DAY" : "INACTIVE_USER",
            active_task_load: null,
          };
        })
        .filter(Boolean);
    }
    debugInfo.skip_reason = "NO_ASSIGNMENT_IN_DAY";
    return withDebug({ created: false, reason: "NO_ASSIGNMENT_IN_DAY", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const staffIds = [...new Set(assignments.map((item) => item.staff_id).filter(Boolean).map((id) => String(id)))];
  const staffObjectIds = staffIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const assignmentUsers = await User.find({
    $or: [
      { id: { $in: staffIds } },
      { _id: { $in: staffObjectIds } },
    ],
  })
    .select("_id id role isActive name email")
    .lean();

  const assignmentUserMap = new Map();
  assignmentUsers.forEach((item) => {
    const identity = getCleanerIdentity(item);
    if (identity) assignmentUserMap.set(identity, item);
    if (item && item._id) assignmentUserMap.set(String(item._id), item);
    if (item && item.id) assignmentUserMap.set(String(item.id), item);
  });
  const assignmentsByCleanerId = new Map();
  assignments.forEach((item) => {
    const key = String(item.staff_id);
    if (!assignmentsByCleanerId.has(key)) assignmentsByCleanerId.set(key, []);
    assignmentsByCleanerId.get(key).push(item);
  });

  const availableCleaners = assignmentUsers.filter(
    (item) => String(item.role || "").toLowerCase() === "cleaner" && item.isActive === true
  );
  debugInfo.available_cleaner_count = availableCleaners.length;

  if (includeDebug) {
    const diagnosticsMap = new Map();

    allSystemCleaners.forEach((cleaner) => {
      const cleanerId = getCleanerIdentity(cleaner);
      if (!cleanerId) return;
      const cleanerAssignments = assignmentsByCleanerId.get(cleanerId) || [];
      diagnosticsMap.set(cleanerId, {
        cleaner_id: cleanerId,
        name: cleaner.name || null,
        email: cleaner.email || null,
        is_active: Boolean(cleaner.isActive),
        has_assignment_in_day: cleanerAssignments.length > 0,
        assignment_statuses: cleanerAssignments.map((item) => item.status),
        eligible: Boolean(cleaner.isActive) && cleanerAssignments.length > 0,
        selected: false,
        reason: !cleaner.isActive
          ? "INACTIVE_USER"
          : cleanerAssignments.length === 0
            ? "NO_ASSIGNMENT_IN_DAY"
            : "ELIGIBLE",
        active_task_load: null,
      });
    });

    staffIds.forEach((staffId) => {
      if (diagnosticsMap.has(staffId)) return;

      const userRecord = assignmentUserMap.get(staffId);
      const cleanerAssignments = assignmentsByCleanerId.get(staffId) || [];

      if (!userRecord) {
        diagnosticsMap.set(staffId, {
          cleaner_id: staffId,
          name: null,
          email: null,
          is_active: null,
          has_assignment_in_day: cleanerAssignments.length > 0,
          assignment_statuses: cleanerAssignments.map((item) => item.status),
          eligible: false,
          selected: false,
          reason: "STAFF_USER_NOT_FOUND",
          active_task_load: null,
        });
        return;
      }

      const isCleanerRole = String(userRecord.role || "").toLowerCase() === "cleaner";
      diagnosticsMap.set(staffId, {
        cleaner_id: staffId,
        name: userRecord.name || null,
        email: userRecord.email || null,
        is_active: Boolean(userRecord.isActive),
        has_assignment_in_day: cleanerAssignments.length > 0,
        assignment_statuses: cleanerAssignments.map((item) => item.status),
        eligible: isCleanerRole && Boolean(userRecord.isActive),
        selected: false,
        reason: !isCleanerRole
          ? "ROLE_NOT_CLEANER"
          : !userRecord.isActive
            ? "INACTIVE_USER"
            : "ELIGIBLE",
        active_task_load: null,
      });
    });

    debugInfo.cleaner_diagnostics = [...diagnosticsMap.values()].sort((a, b) =>
      String(a.cleaner_id).localeCompare(String(b.cleaner_id))
    );
  }

  if (availableCleaners.length === 0) {
    debugInfo.skip_reason = "NO_ACTIVE_CLEANER";
    return withDebug({ created: false, reason: "NO_ACTIVE_CLEANER", booking_id: bookingId }, debugInfo, includeDebug);
  }

  const eligibleCleanerIds = availableCleaners
    .map((item) => getCleanerIdentity(item))
    .filter(Boolean);

  const selectedAssignment = await selectAssignmentWithLoadBalancing(
    assignments,
    eligibleCleanerIds,
    {
      requestSource,
      dueAt,
    }
  );

  if (!selectedAssignment) {
    if (includeDebug) {
      const eligibleSet = new Set(eligibleCleanerIds.map((id) => String(id)));
      const checkedInEligibleSet = new Set(
        assignments
          .filter((item) => item.status === "CHECKED_IN" && eligibleSet.has(String(item.staff_id)))
          .map((item) => String(item.staff_id))
      );

      debugInfo.cleaner_diagnostics = debugInfo.cleaner_diagnostics.map((item) => {
        if (!eligibleSet.has(String(item.cleaner_id))) return item;
        return {
          ...item,
          reason: checkedInEligibleSet.size > 0 && !checkedInEligibleSet.has(String(item.cleaner_id))
            ? "NOT_SELECTED_NOT_CHECKED_IN"
            : "NO_ELIGIBLE_ASSIGNMENT",
        };
      });
    }
    debugInfo.skip_reason = "NO_ELIGIBLE_ASSIGNMENT";
    return withDebug({ created: false, reason: "NO_ELIGIBLE_ASSIGNMENT", booking_id: bookingId }, debugInfo, includeDebug);
  }
  debugInfo.selected_assignment_id = selectedAssignment.id;
  debugInfo.selected_cleaner_id = selectedAssignment.staff_id;

  if (includeDebug) {
    const eligibleSet = new Set(eligibleCleanerIds.map((id) => String(id)));
    const selectedCleanerId = String(selectedAssignment.staff_id);
    const checkedInEligibleSet = new Set(
      assignments
        .filter((item) => item.status === "CHECKED_IN" && eligibleSet.has(String(item.staff_id)))
        .map((item) => String(item.staff_id))
    );

    const counts = await CleaningTask.aggregate([
      {
        $match: {
          cleaner_id: { $in: eligibleCleanerIds.map((id) => String(id)) },
          status: { $in: ACTIVE_TASK_STATUSES },
        },
      },
      {
        $group: {
          _id: "$cleaner_id",
          total: { $sum: 1 },
        },
      },
    ]);
    const loadMap = new Map(counts.map((item) => [String(item._id), Number(item.total) || 0]));

    debugInfo.cleaner_diagnostics = debugInfo.cleaner_diagnostics.map((item) => {
      const cleanerId = String(item.cleaner_id);
      if (!eligibleSet.has(cleanerId)) return item;

      const isSelected = cleanerId === selectedCleanerId;
      return {
        ...item,
        selected: isSelected,
        active_task_load: loadMap.has(cleanerId) ? loadMap.get(cleanerId) : 0,
        reason: isSelected
          ? "SELECTED"
          : checkedInEligibleSet.size > 0 && !checkedInEligibleSet.has(cleanerId)
            ? "NOT_SELECTED_NOT_CHECKED_IN"
            : "NOT_SELECTED_LOAD_BALANCING",
      };
    });
  }

  const payload = {
    pod_id: podId,
    booking_id: bookingId,
    cleaner_id: selectedAssignment.staff_id,
    shift_assignment_id: selectedAssignment.id,
    request_source: requestSource,
    estimated_start_time: estimatedStartTime,
    due_at: dueAt,
    assigned_at: new Date(),
    start_time: null,
    end_time: null,
    status: getInitialAutoAssignStatus(bookingLike, trigger),
  };

  applyStatusAuditFields(payload);

  if (dryRun) {
    return withDebug({
      created: false,
      reason: "DRY_RUN_ELIGIBLE",
      booking_id: bookingId,
      trigger,
      preview: {
        cleaner_id: payload.cleaner_id,
        shift_assignment_id: payload.shift_assignment_id,
        request_source: payload.request_source,
        estimated_start_time: payload.estimated_start_time,
        due_at: payload.due_at,
        status: payload.status,
      },
    }, debugInfo, includeDebug);
  }

  const createdTask = await CleaningTask.create(payload);

  await notifyCleanerTaskAssigned(createdTask, {
    dedupeSuffix: trigger || "AUTO_ASSIGN",
  });

  return withDebug({
    created: true,
    reason: "CREATED",
    trigger,
    booking_id: bookingId,
    task: createdTask,
  }, debugInfo, includeDebug);
};

exports.diagnoseAutoAssignForBooking = async (bookingId, options = {}) => {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    throw createError("bookingId is required", 400);
  }

  const booking = await Booking.findOne({ id: normalizedBookingId })
    .select("id pod_id start_time end_time status checkin_state cleaner_access_allowed -_id")
    .lean();

  if (!booking) {
    throw createError("Booking not found", 404);
  }

  const result = await exports.autoAssignTaskForBooking(booking, {
    trigger: options.trigger || "DEBUG_MANUAL",
    dry_run: true,
    include_debug: true,
  });

  return {
    booking,
    auto_assign_diagnostic: result,
  };
};

exports.createCleaningTask = async (data) => {
  const {
    pod_id,
    booking_id,
    cleaner_id,
    shift_assignment_id,
    request_source,
    estimated_start_time,
    due_at,
    assigned_at,
    notified_at,
    accepted_at,
    start_time,
    end_time,
    status,
    note,
    rejection_reason,
    reassigned_from_cleaner_id,
  } = data;

  if (!pod_id || !cleaner_id) {
    throw createError("pod_id and cleaner_id are required", 400);
  }

  const normalizedStatus = normalizeStatus(status) || "ASSIGNED";
  validateStatus(normalizedStatus);
  const normalizedRequestSource = normalizeRequestSource(request_source) || "USER_REQUEST";
  validateRequestSource(normalizedRequestSource);

  const [pod, booking, cleaner, assignment, reassignedCleaner] = await Promise.all([
    Pod.findOne({ id: pod_id }).select("id").lean(),
    booking_id ? Booking.findOne({ id: booking_id }).select("id").lean() : Promise.resolve(null),
    User.findOne(buildUserIdentityQuery(cleaner_id)).select("_id id role isActive").lean(),
    shift_assignment_id
      ? StaffShiftAssignment.findOne({ id: shift_assignment_id }).select("id").lean()
      : Promise.resolve(null),
    reassigned_from_cleaner_id
      ? User.findOne(buildUserIdentityQuery(reassigned_from_cleaner_id))
        .select("_id id role")
        .lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (booking_id && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (shift_assignment_id && !assignment) throw createError("Shift assignment not found", 404);
  if (reassigned_from_cleaner_id && !reassignedCleaner) {
    throw createError("reassigned_from_cleaner_id user not found", 404);
  }
  if (reassignedCleaner && reassignedCleaner.role !== "cleaner") {
    throw createError("reassigned_from_cleaner_id must have cleaner role", 400);
  }

  const payload = {
    pod_id,
    booking_id: booking_id || null,
    cleaner_id,
    shift_assignment_id: shift_assignment_id || null,
    estimated_start_time: estimated_start_time || null,
    request_source: normalizedRequestSource,
    due_at: due_at || null,
    assigned_at: assigned_at || null,
    notified_at: notified_at || null,
    accepted_at: accepted_at || null,
    start_time: start_time || null,
    end_time: end_time || null,
    status: normalizedStatus,
    note: note || null,
    rejection_reason: rejection_reason || null,
    reassigned_from_cleaner_id: reassigned_from_cleaner_id || null,
  };

  applyStatusAuditFields(payload);
  const createdTask = await CleaningTask.create(payload);

  if (["ASSIGNED", "NOTIFIED"].includes(String(createdTask.status || ""))) {
    await notifyCleanerTaskAssigned(createdTask, {
      dedupeSuffix: "MANUAL_CREATE",
    });
  }

  return createdTask;
};

const enrichCleaningTasksWithRelatedData = async (tasks = []) => {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return tasks;
  }

  const taskObjects = tasks.map((task) => (typeof task.toObject === "function" ? task.toObject() : task));

  const podIds = [...new Set(taskObjects.map((task) => String(task.pod_id || "")).filter(Boolean))];
  const bookingIds = [...new Set(taskObjects.map((task) => String(task.booking_id || "")).filter(Boolean))];

  const [pods, bookings] = await Promise.all([
    podIds.length > 0
      ? Pod.find({ id: { $in: podIds } }).select("id name cluster_id").lean()
      : Promise.resolve([]),
    bookingIds.length > 0
      ? Booking.find({ id: { $in: bookingIds } })
        .select("id user_id start_time end_time actual_end_time checked_in_at checkin_state")
        .lean()
      : Promise.resolve([]),
  ]);

  const podById = new Map(pods.map((pod) => [String(pod.id), pod]));
  const bookingById = new Map(bookings.map((booking) => [String(booking.id), booking]));

  const userIds = [...new Set(bookings.map((booking) => String(booking.user_id || "")).filter(Boolean))];
  const clusterIds = [...new Set(pods.map((pod) => String(pod.cluster_id || "")).filter(Boolean))];

  const [bookingUsers, podClusters] = await Promise.all([
    userIds.length > 0
      ? User.find({
        $or: [
          { id: { $in: userIds } },
          {
            _id: {
              $in: userIds
                .filter((id) => mongoose.Types.ObjectId.isValid(id))
                .map((id) => new mongoose.Types.ObjectId(id)),
            },
          },
        ],
      })
        .select("_id id name")
        .lean()
      : Promise.resolve([]),
    clusterIds.length > 0
      ? PodCluster.find({ id: { $in: clusterIds } }).select("id name location_id").lean()
      : Promise.resolve([]),
  ]);

  const bookingUserById = new Map();
  bookingUsers.forEach((userItem) => {
    if (userItem && userItem.id) bookingUserById.set(String(userItem.id), userItem);
    if (userItem && userItem._id) bookingUserById.set(String(userItem._id), userItem);
  });

  const clusterById = new Map(podClusters.map((cluster) => [String(cluster.id), cluster]));
  const locationIds = [...new Set(podClusters.map((cluster) => String(cluster.location_id || "")).filter(Boolean))];

  const locations = locationIds.length > 0
    ? await Location.find({ id: { $in: locationIds } }).select("id name").lean()
    : [];
  const locationById = new Map(locations.map((location) => [String(location.id), location]));

  return taskObjects.map((task) => {
    const pod = podById.get(String(task.pod_id || "")) || null;
    const booking = bookingById.get(String(task.booking_id || "")) || null;
    const bookingUser = booking ? bookingUserById.get(String(booking.user_id || "")) || null : null;
    const podCluster = pod ? clusterById.get(String(pod.cluster_id || "")) || null : null;
    const location = podCluster ? locationById.get(String(podCluster.location_id || "")) || null : null;

    return {
      ...task,
      pod_name: pod ? pod.name || null : null,
      pod_cluster_id: pod ? pod.cluster_id || null : null,
      pod_cluster_name: podCluster ? podCluster.name || null : null,
      location_id: podCluster ? podCluster.location_id || null : null,
      location_name: location ? location.name || null : null,
      booking_guest_id: booking ? booking.user_id || null : null,
      booking_guest_name: bookingUser ? bookingUser.name || null : null,
      booking_start_time: booking ? booking.start_time || null : null,
      booking_end_time: booking ? booking.end_time || null : null,
      booking_actual_end_time: booking ? booking.actual_end_time || null : null,
      booking_checked_in_at: booking ? booking.checked_in_at || null : null,
      booking_checkin_state: booking ? booking.checkin_state || null : null,
      actual_start_time: task.start_time || null,
      actual_end_time: task.end_time || null,
      action_label: getCleaningTaskActionLabel(task.status),
    };
  });
};

exports.getAllCleaningTasks = async (query = {}) => {
  const filter = {};

  if (query.pod_ids) {
    filter.pod_id = { $in: query.pod_ids.split(",") };
  } else if (query.pod_id) {
    filter.pod_id = query.pod_id;
  }
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.cleaner_id) filter.cleaner_id = query.cleaner_id;
  if (query.shift_assignment_id) filter.shift_assignment_id = query.shift_assignment_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    validateStatus(normalizedStatus);
    filter.status = normalizedStatus;
  }
  if (query.request_source) {
    const normalizedRequestSource = normalizeRequestSource(query.request_source);
    validateRequestSource(normalizedRequestSource);
    filter.request_source = normalizedRequestSource;
  }

  applyDueRangeFilter(filter, query);

  const tasks = await CleaningTask.find(filter).sort({ created_at: -1 });
  return enrichCleaningTasksWithRelatedData(tasks);
};

exports.getMyCleaningTasks = async (user, query = {}) => {
  if (!user) {
    throw createError("User context is required", 401);
  }

  const cleanerIds = [...new Set(resolveActorCleanerIds(user))];

  if (cleanerIds.length === 0) {
    throw createError("Unable to resolve cleaner id", 400);
  }

  const filter = {
    cleaner_id: { $in: [...new Set(cleanerIds)] },
  };

  if (query.pod_ids) {
    filter.pod_id = { $in: query.pod_ids.split(",") };
  } else if (query.pod_id) {
    filter.pod_id = query.pod_id;
  }
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.shift_assignment_id) filter.shift_assignment_id = query.shift_assignment_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    validateStatus(normalizedStatus);
    filter.status = normalizedStatus;
  }
  if (query.request_source) {
    const normalizedRequestSource = normalizeRequestSource(query.request_source);
    validateRequestSource(normalizedRequestSource);
    filter.request_source = normalizedRequestSource;
  }

  applyDueRangeFilter(filter, query);

  const tasks = await CleaningTask.find(filter).sort({ created_at: -1 });
  return enrichCleaningTasksWithRelatedData(tasks);
};

exports.getMyCleanerKeyByTaskId = async (taskId, actor) => {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw createError("task id is required", 400, "TASK_ID_REQUIRED");
  }

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole !== "cleaner") {
    throw createError("Only cleaner can retrieve cleaner key", 403, "CLEANER_ONLY");
  }

  const actorCleanerIds = [...new Set(resolveActorCleanerIds(actor))];
  if (actorCleanerIds.length === 0) {
    throw createError("Unable to resolve cleaner id", 400, "AUTH_USER_NOT_RESOLVED");
  }

  const task = await CleaningTask.findOne({ id: normalizedTaskId })
    .select("id booking_id cleaner_id status pod_id")
    .lean();
  if (!task) {
    throw createError("Cleaning task not found", 404, "CLEANING_TASK_NOT_FOUND");
  }

  if (!task.booking_id) {
    throw createError("Cleaning task does not link to any booking", 400, "TASK_BOOKING_LINK_MISSING");
  }

  if (!["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS", "DONE"].includes(String(task.status || ""))) {
    throw createError("Cleaning task is not eligible for key retrieval", 400, "TASK_NOT_ELIGIBLE_FOR_KEY");
  }

  if (!actorCleanerIds.includes(String(task.cleaner_id))) {
    throw createError("You are not allowed to retrieve key for this task", 403, "TASK_NOT_ASSIGNED_TO_CLEANER");
  }

  const booking = await Booking.findOne({ id: String(task.booking_id) })
    .select("id pod_id start_time end_time status checkin_state cleaner_access_allowed")
    .lean();
  if (!booking) {
    throw createError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (String(booking.checkin_state || "").toUpperCase() === "NO_SHOW") {
    throw createError("Cleaner access is blocked for NO_SHOW booking", 403, "BOOKING_NO_SHOW");
  }

  if (booking.status === "IN_USE" && !booking.cleaner_access_allowed) {
    throw createError("Cleaner access is not confirmed by user", 403, "CLEANER_ACCESS_NOT_ALLOWED");
  }

  const now = new Date();
  const isInUseUrgentCleaning = booking.status === "IN_USE";
  const isCompletedCleaning = booking.status === "COMPLETED";

  if (!isInUseUrgentCleaning && !isCompletedCleaning) {
    throw createError(
      "Cleaner chi duoc vao khi booking dang IN_USE (co cho phep) hoac COMPLETED",
      400,
      "BOOKING_STATUS_NOT_ELIGIBLE"
    );
  }

  const actorCleanerId = String(task.cleaner_id);
  await OnlineKey.updateMany(
    {
      booking_id: String(booking.id),
      key_type: "CLEANER",
      is_revoked: false,
      user_id: { $ne: actorCleanerId },
    },
    { $set: { is_revoked: true } }
  );

  let cleanerKey = await OnlineKey.findOne({
    booking_id: String(booking.id),
    key_type: "CLEANER",
    user_id: actorCleanerId,
    is_revoked: false,
  })
    .sort({ createdAt: -1 })
    .select("id booking_id pod_id user_id key_type key_token valid_from valid_to is_revoked createdAt updatedAt");

  if (!cleanerKey) {
    cleanerKey = await OnlineKey.create({
      booking_id: String(booking.id),
      pod_id: String(booking.pod_id || task.pod_id),
      user_id: actorCleanerId,
      key_type: "CLEANER",
      key_token: await generateUniqueOnlineKeyToken(),
      valid_from: booking.start_time ? new Date(booking.start_time) : now,
      valid_to: booking.end_time
        ? new Date(
          Math.max(
            new Date(booking.end_time).getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000,
            now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000
          )
        )
        : new Date(now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000),
      is_revoked: false,
    });
  }

  const keyData = typeof cleanerKey.toObject === "function" ? cleanerKey.toObject() : cleanerKey;

  return {
    task_id: String(task.id),
    booking_id: String(booking.id),
    cleaner_id: actorCleanerId,
    booking_status: booking.status,
    booking_checkin_state: booking.checkin_state,
    online_key: {
      ...keyData,
      role: "cleaner",
    },
  };
};

exports.getCleaningTaskById = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);
  // Reuse enrich logic for single task
  const enriched = await enrichCleaningTasksWithRelatedData([task]);
  return enriched[0] || null;
};

exports.updateCleaningTask = async (id, data, actor = null) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole === "cleaner") {
    const actorCleanerIds = [...new Set(resolveActorCleanerIds(actor))];

    if (actorCleanerIds.length === 0) {
      throw createError("Unable to resolve cleaner id", 400);
    }

    const isOwner = actorCleanerIds.includes(String(task.cleaner_id));
    if (!isOwner) {
      throw createError("You are not allowed to update this cleaning task", 403);
    }
  }

  const nextPodId = data.pod_id !== undefined ? data.pod_id : task.pod_id;
  const nextBookingId = data.booking_id !== undefined ? data.booking_id : task.booking_id;
  const nextCleanerId = data.cleaner_id !== undefined ? data.cleaner_id : task.cleaner_id;
  const nextShiftAssignmentId =
    data.shift_assignment_id !== undefined ? data.shift_assignment_id : task.shift_assignment_id;

  const nextStatus = data.status !== undefined ? normalizeStatus(data.status) : task.status;
  validateStatus(nextStatus);
  const nextRequestSource =
    data.request_source !== undefined ? normalizeRequestSource(data.request_source) : task.request_source;
  validateRequestSource(nextRequestSource);

  const nextReassignedFromCleanerId =
    data.reassigned_from_cleaner_id !== undefined
      ? data.reassigned_from_cleaner_id
      : task.reassigned_from_cleaner_id;

  const [pod, booking, cleaner, assignment, reassignedCleaner] = await Promise.all([
    Pod.findOne({ id: nextPodId }).select("id cluster_id").lean(),
    nextBookingId ? Booking.findOne({ id: nextBookingId }).select("id").lean() : Promise.resolve(null),
    User.findOne(buildUserIdentityQuery(nextCleanerId)).select("_id id role isActive").lean(),
    nextShiftAssignmentId
      ? StaffShiftAssignment.findOne({ id: nextShiftAssignmentId }).select("id").lean()
      : Promise.resolve(null),
    nextReassignedFromCleanerId
      ? User.findOne(buildUserIdentityQuery(nextReassignedFromCleanerId))
        .select("_id id role")
        .lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (nextBookingId && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (nextShiftAssignmentId && !assignment) throw createError("Shift assignment not found", 404);
  if (nextReassignedFromCleanerId && !reassignedCleaner) {
    throw createError("reassigned_from_cleaner_id user not found", 404);
  }
  if (reassignedCleaner && reassignedCleaner.role !== "cleaner") {
    throw createError("reassigned_from_cleaner_id must have cleaner role", 400);
  }

  if (["ACCEPTED", "IN_PROGRESS", "DONE"].includes(nextStatus)) {
    const podCluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id").lean();
    if (!podCluster) {
      throw createError("Pod cluster not found", 404);
    }

    const checkedInAtLocation = await isCleanerCheckedInAtLocation(nextCleanerId, podCluster.location_id);
    if (!checkedInAtLocation) {
      throw createError("Cleaner must be CHECKED_IN at this location before handling task", 403);
    }
  }

  if (nextStatus === "DONE") {
    const afterPhotoCount = await CleaningPhoto.countDocuments({
      cleaning_task_id: String(task.id),
      type: "AFTER",
    });

    if (afterPhotoCount < 1) {
      throw createError('At least one "AFTER" photo is required before completing task', 400);
    }
  }

  const previousStatus = task.status;
  const previousCleanerId = String(task.cleaner_id || "");
  const bookingIdBeforeUpdate = String(task.booking_id || "").trim() || null;

  task.pod_id = nextPodId;
  task.booking_id = nextBookingId || null;
  const cleanerChanged = String(task.cleaner_id) !== String(nextCleanerId);

  if (cleanerChanged && data.reassigned_from_cleaner_id === undefined) {
    task.reassigned_from_cleaner_id = task.cleaner_id;
  }

  task.cleaner_id = nextCleanerId;
  task.shift_assignment_id = nextShiftAssignmentId || null;
  task.estimated_start_time = data.estimated_start_time !== undefined ? data.estimated_start_time : task.estimated_start_time;
  task.request_source = nextRequestSource;
  task.due_at = data.due_at !== undefined ? data.due_at : task.due_at;
  task.assigned_at = data.assigned_at !== undefined ? data.assigned_at : task.assigned_at;
  task.notified_at = data.notified_at !== undefined ? data.notified_at : task.notified_at;
  task.accepted_at = data.accepted_at !== undefined ? data.accepted_at : task.accepted_at;
  task.start_time = data.start_time !== undefined ? data.start_time : task.start_time;
  task.end_time = data.end_time !== undefined ? data.end_time : task.end_time;
  task.status = nextStatus;
  task.note = data.note !== undefined ? data.note : task.note;
  task.rejection_reason =
    data.rejection_reason !== undefined ? data.rejection_reason : task.rejection_reason;
  if (data.reassigned_from_cleaner_id !== undefined) {
    task.reassigned_from_cleaner_id = data.reassigned_from_cleaner_id;
  }

  applyStatusAuditFields(task, previousStatus);

  await task.save();

  const bookingIdForRefund = String(task.booking_id || "").trim() || bookingIdBeforeUpdate;

  const statusChangedToDispatchable =
    previousStatus !== task.status && ["ASSIGNED", "NOTIFIED"].includes(String(task.status || ""));
  const cleanerChangedAfterSave = previousCleanerId !== String(task.cleaner_id || "");

  if (statusChangedToDispatchable || cleanerChangedAfterSave) {
    await notifyCleanerTaskAssigned(task, {
      dedupeSuffix: cleanerChangedAfterSave ? "REASSIGNED" : "STATUS_UPDATED",
    });
  }

  if (previousStatus !== task.status) {
    await emitCleaningTaskStatusChangedRealtime({
      task,
      previousStatus,
      previousCleanerId,
    });
  }


  const shouldTriggerRefundRecheck =
    previousStatus !== nextStatus && REFUND_TRIGGER_TERMINAL_STATUSES.includes(String(nextStatus || ""));

  if (shouldTriggerRefundRecheck) {
    if (!bookingIdForRefund) {
      console.warn("Auto refund trigger skipped after terminal transition", {
        reason: "MISSING_BOOKING_ID_ON_TERMINAL_TRANSITION",
        task_id: task.id,
        previous_status: String(previousStatus || ""),
        next_status: String(nextStatus || ""),
      });
    } else {
      try {
        await tryAutoRefundDepositAfterCleaningDone({ bookingId: bookingIdForRefund });
      } catch (error) {
        console.error("Auto refund deposit after cleaning DONE failed", {
          task_id: task.id,
          booking_id: bookingIdForRefund,
          previous_status: String(previousStatus || ""),
          next_status: String(nextStatus || ""),
          error: error?.message || error,
        });
      }
    }
  }

  return task;
};

exports.deleteCleaningTask = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  await CleaningTask.deleteOne({ id });
  return { message: "Cleaning task deleted successfully" };
};

exports.backfillMissingCleaningTasks = async (options = {}) => {
  const dryRun =
    options.dry_run === true ||
    String(options.dry_run || "").toLowerCase() === "true";

  const cleanerAccessOnly =
    options.cleaner_access_only === undefined
      ? true
      : options.cleaner_access_only === true || String(options.cleaner_access_only).toLowerCase() === "true";

  const limitRaw = Number(options.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, limitRaw)) : 200;

  const fromDate = options.from_date ? new Date(options.from_date) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    throw createError("from_date must be a valid date", 400);
  }

  const toDate = options.to_date ? new Date(options.to_date) : null;
  if (toDate && Number.isNaN(toDate.getTime())) {
    throw createError("to_date must be a valid date", 400);
  }

  const bookingQuery = {
    status: { $nin: ["CANCELLED"] },
    checkin_state: { $ne: "NO_SHOW" },
  };

  if (cleanerAccessOnly) {
    bookingQuery.cleaner_access_allowed = true;
  }

  if (fromDate || toDate) {
    bookingQuery.end_time = {};
    if (fromDate) bookingQuery.end_time.$gte = fromDate;
    if (toDate) bookingQuery.end_time.$lte = toDate;
  }

  const bookings = await Booking.find(bookingQuery)
    .sort({ end_time: 1 })
    .limit(limit)
    .select("id pod_id start_time end_time cleaner_access_allowed status")
    .lean();

  const summary = {
    dry_run: dryRun,
    cleaner_access_only: cleanerAccessOnly,
    scanned: bookings.length,
    created_count: 0,
    skipped_count: 0,
    failed_count: 0,
    created_booking_ids: [],
    skipped: [],
    failed: [],
  };

  for (const booking of bookings) {
    const existing = await CleaningTask.findOne({
      booking_id: booking.id,
      request_source: "SYSTEM_RETRY",
    })
      .select("id")
      .lean();
    if (existing) {
      summary.skipped_count += 1;
      summary.skipped.push({ booking_id: booking.id, reason: "ALREADY_BACKFILLED" });
      continue;
    }

    if (dryRun) {
      summary.created_count += 1;
      summary.created_booking_ids.push(booking.id);
      continue;
    }

    try {
      const result = await exports.autoAssignTaskForBooking(booking, { trigger: "SYSTEM_RETRY_BACKFILL" });
      if (result && result.created) {
        summary.created_count += 1;
        summary.created_booking_ids.push(booking.id);
      } else {
        summary.skipped_count += 1;
        summary.skipped.push({ booking_id: booking.id, reason: result?.reason || "SKIPPED" });
      }
    } catch (error) {
      summary.failed_count += 1;
      summary.failed.push({
        booking_id: booking.id,
        reason: error.message || "UNKNOWN_ERROR",
      });
    }
  }

  return summary;
};

exports.sendSlaReminderNotifications = async (options = {}) => {
  const leadMinutesRaw = Number(options.lead_minutes || 15);
  const leadMinutes = Number.isFinite(leadMinutesRaw) ? Math.max(10, Math.min(15, leadMinutesRaw)) : 15;

  const now = new Date();
  const dueThreshold = new Date(now.getTime() + leadMinutes * 60 * 1000);

  const candidateTasks = await CleaningTask.find({
    status: { $in: ["ASSIGNED", "ACCEPTED"] },
    due_at: { $gte: now, $lte: dueThreshold },
  })
    .select("id cleaner_id pod_id booking_id due_at status")
    .lean();

  if (candidateTasks.length === 0) {
    return { scanned: 0, reminded: 0, lead_minutes: leadMinutes };
  }

  let reminded = 0;

  for (const task of candidateTasks) {
    const cleanerUserId = await resolveNotificationUserId(task.cleaner_id);
    if (!cleanerUserId) {
      continue;
    }

    const { podCode } = await resolvePodContext(task.pod_id);
    const dueAtText = formatDateTimeVi(task.due_at);

    await notificationService.sendToUser(cleanerUserId, {
      title: `Canh bao SLA: Pod ${podCode} sap qua han`,
      message: `Canh bao: Pod ${podCode} sap qua han ve sinh. Han chot: ${dueAtText}. Vui long bat dau ngay!`,
      type: "CLEANING",
      event_code: "CLEANING_TASK_SLA_REMINDER",
      dedupe_key: `CLEANING_TASK_SLA_REMINDER:${String(task.id)}:${cleanerUserId}`,
      data: {
        cleaning_task_id: String(task.id),
        booking_id: task.booking_id ? String(task.booking_id) : null,
        pod_id: String(task.pod_id),
        pod_code: podCode,
        due_at: task.due_at || null,
        lead_minutes: String(leadMinutes),
      },
    });

    emitCleanerNotificationEvent({
      user_id: cleanerUserId,
      notification: {
        event: "CLEANING_TASK_SLA_REMINDER",
        payload: {
          cleaning_task_id: String(task.id),
          booking_id: task.booking_id ? String(task.booking_id) : null,
          pod_id: String(task.pod_id),
          pod_code: podCode,
          due_at: task.due_at || null,
          lead_minutes: String(leadMinutes),
          title: `Canh bao SLA: Pod ${podCode} sap qua han`,
          message: `Canh bao: Pod ${podCode} sap qua han ve sinh. Han chot: ${dueAtText}. Vui long bat dau ngay!`,
        },
      },
    });

    reminded += 1;
  }

  return {
    scanned: candidateTasks.length,
    reminded,
    lead_minutes: leadMinutes,
  };
};

exports.startSlaReminderJob = (intervalMinutes = 5, leadMinutes = 15) => {
  const safeIntervalMinutes = Math.max(1, Number(intervalMinutes) || 5);

  console.log(
    `Starting cleaning SLA reminder job (interval: ${safeIntervalMinutes} minute(s), lead: ${leadMinutes} minute(s))`
  );

  const runReminder = async () => {
    try {
      const result = await exports.sendSlaReminderNotifications({ lead_minutes: leadMinutes });
      if (result.reminded > 0) {
        console.log(
          `Cleaning SLA reminder job result: scanned=${result.scanned}, reminded=${result.reminded}, lead=${result.lead_minutes}`
        );
      }
    } catch (error) {
      console.error("Cleaning SLA reminder job error:", error);
    }
  };

  runReminder().catch(() => null);
  setInterval(runReminder, safeIntervalMinutes * 60 * 1000);
};

exports.startBackfillJob = (intervalMinutes = 60, defaultOptions = {}) => {
  const safeIntervalMinutes = Math.max(5, Number(intervalMinutes) || 60);

  console.log(`Starting cleaning task backfill job (interval: ${safeIntervalMinutes} minute(s))`);

  const runBackfill = async () => {
    try {
      const result = await exports.backfillMissingCleaningTasks(defaultOptions);
      console.log(
        `Cleaning task backfill job result: scanned=${result.scanned}, created=${result.created_count}, skipped=${result.skipped_count}, failed=${result.failed_count}`
      );
    } catch (error) {
      console.error("Cleaning task backfill job error:", error);
    }
  };

  runBackfill().catch(() => null);
  setInterval(runBackfill, safeIntervalMinutes * 60 * 1000);
};
