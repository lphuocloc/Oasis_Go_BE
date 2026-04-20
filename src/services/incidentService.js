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
const debtService = require("./debtService");
const { emitCleanerNotificationEvent } = require("../socket/socketServer");

const INCIDENT_STATUSES = ["PENDING", "RESOLVED", "DISMISSED"];
const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const INCIDENT_TYPES = ["OPERATIONAL", "DAMAGE_REPORT"];
const INCIDENT_DETAIL_TYPES = ["ITEM", "SERVICE"];
const REFUND_BLOCKING_TASK_STATUSES = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS", "MISSED"];
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

const resolveOrderById = async (orderId, session = null) => {
  let query = BookingOrder.findOne({ id: String(orderId || "") })
    .select("id user_id status deposit_total deposit_settlement_status outstanding_damage_amount deposit_settled_at");
  if (session) query = query.session(session);
  return query;
};

const settleOrderDepositAfterIncidentsInternal = async ({
  orderId,
  trigger = "SYSTEM",
  session,
} = {}) => {
  const normalizedOrderId = String(orderId || "").trim();
  const logPrefix = "[DepositSettlement][Incident]";

  console.info(`${logPrefix} Start`, {
    order_id: normalizedOrderId || null,
    trigger,
  });

  if (!normalizedOrderId) {
    console.warn(`${logPrefix} Stop`, {
      reason: "MISSING_ORDER_ID",
      trigger,
    });
    return { settled: false, reason: "MISSING_ORDER_ID" };
  }

  const order = await resolveOrderById(normalizedOrderId, session);
  if (!order) {
    console.warn(`${logPrefix} Stop`, {
      reason: "ORDER_NOT_FOUND",
      order_id: normalizedOrderId,
      trigger,
    });
    return { settled: false, reason: "ORDER_NOT_FOUND" };
  }

  console.info(`${logPrefix} OrderLoaded`, {
    order_id: normalizedOrderId,
    order_status: String(order.status || ""),
    deposit_settlement_status: String(order.deposit_settlement_status || ""),
    deposit_total: Number(order.deposit_total || 0),
  });

  if (!["PAID", "PARTIAL_CANCEL"].includes(String(order.status || "").toUpperCase())) {
    console.warn(`${logPrefix} Stop`, {
      reason: "ORDER_NOT_ELIGIBLE",
      order_id: normalizedOrderId,
      order_status: String(order.status || ""),
    });
    return { settled: false, reason: "ORDER_NOT_ELIGIBLE", order_id: normalizedOrderId };
  }

  if (String(order.deposit_settlement_status || "") !== "PENDING_INSPECTION") {
    console.warn(`${logPrefix} Stop`, {
      reason: "ORDER_ALREADY_SETTLED",
      order_id: normalizedOrderId,
      deposit_settlement_status: String(order.deposit_settlement_status || ""),
    });
    return {
      settled: false,
      reason: "ORDER_ALREADY_SETTLED",
      order_id: normalizedOrderId,
      deposit_settlement_status: String(order.deposit_settlement_status || ""),
    };
  }

  const bookings = await Booking.find({ order_id: normalizedOrderId })
    .select("id status")
    .session(session)
    .lean();

  console.info(`${logPrefix} BookingsLoaded`, {
    order_id: normalizedOrderId,
    booking_count: bookings.length,
  });

  if (!bookings.length) {
    console.warn(`${logPrefix} Stop`, {
      reason: "ORDER_BOOKINGS_NOT_FOUND",
      order_id: normalizedOrderId,
    });
    return { settled: false, reason: "ORDER_BOOKINGS_NOT_FOUND", order_id: normalizedOrderId };
  }

  const bookingIds = bookings.map((booking) => String(booking.id || "")).filter(Boolean);

  const hasNonTerminalBooking = bookings.some(
    (booking) => !ORDER_BOOKING_TERMINAL_STATUSES.includes(String(booking.status || "").toUpperCase())
  );
  if (hasNonTerminalBooking) {
    console.warn(`${logPrefix} Stop`, {
      reason: "ORDER_BOOKINGS_NOT_TERMINAL",
      order_id: normalizedOrderId,
      booking_statuses: bookings.map((booking) => String(booking.status || "").toUpperCase()),
    });
    return { settled: false, reason: "ORDER_BOOKINGS_NOT_TERMINAL", order_id: normalizedOrderId };
  }

  const unfinishedTask = await CleaningTask.findOne({
    booking_id: { $in: bookingIds },
    status: { $in: REFUND_BLOCKING_TASK_STATUSES },
  })
    .select("id booking_id status")
    .session(session)
    .lean();
  if (unfinishedTask) {
    console.warn(`${logPrefix} Stop`, {
      reason: "CLEANING_NOT_COMPLETED",
      order_id: normalizedOrderId,
      task_id: String(unfinishedTask.id || ""),
      task_status: String(unfinishedTask.status || ""),
    });
    return {
      settled: false,
      reason: "CLEANING_NOT_COMPLETED",
      order_id: normalizedOrderId,
      task_id: String(unfinishedTask.id || ""),
    };
  }

  const pendingIncident = await Incident.findOne({
    booking_id: { $in: bookingIds },
    status: "PENDING",
  })
    .select("id")
    .session(session)
    .lean();
  if (pendingIncident) {
    console.warn(`${logPrefix} Stop`, {
      reason: "PENDING_INCIDENT_EXISTS",
      order_id: normalizedOrderId,
      incident_id: String(pendingIncident.id || ""),
    });
    return {
      settled: false,
      reason: "PENDING_INCIDENT_EXISTS",
      order_id: normalizedOrderId,
      incident_id: String(pendingIncident.id || ""),
    };
  }

  const resolvedIncidents = await Incident.find({
    booking_id: { $in: bookingIds },
    status: "RESOLVED",
  })
    .select("id booking_id status incident_type estimated_total_value")
    .session(session)
    .lean();

  const resolvedIncidentIds = resolvedIncidents
    .map((incident) => String(incident.id || ""))
    .filter(Boolean);
  const incidentDetailMap = await buildIncidentDetailMap(resolvedIncidentIds, session);

  const incidentBreakdown = [];
  let totalResolvedIncidentDamage = 0;
  for (const incident of resolvedIncidents) {
    const amount = await getIncidentDamageTotal(incident);
    if (amount <= 0) continue;

    const incidentDetails = (incidentDetailMap[String(incident.id || "")] || []).map((detail) => ({
      type: String(detail.type || "").toUpperCase(),
      item_id: detail.item_id ? String(detail.item_id) : null,
      service_catalog_id: detail.service_catalog_id ? String(detail.service_catalog_id) : null,
      name_snapshot: detail.name_snapshot || null,
      quantity: Number(detail.quantity || 0),
      unit_cost_snapshot: Number(detail.unit_cost_snapshot || 0),
      total_cost: Number(detail.total_cost || 0),
      note: detail.note || null,
    }));

    const damagedProducts = incidentDetails
      .filter((detail) => detail.type === "ITEM")
      .map((detail) => ({
        item_id: detail.item_id,
        name_snapshot: detail.name_snapshot,
        quantity: detail.quantity,
        unit_cost_snapshot: detail.unit_cost_snapshot,
        total_cost: detail.total_cost,
        note: detail.note,
      }));

    totalResolvedIncidentDamage += amount;
    incidentBreakdown.push({
      incident_id: String(incident.id || ""),
      booking_id: String(incident.booking_id || ""),
      amount,
      status: String(incident.status || "").toUpperCase(),
      incident_details: incidentDetails,
      damaged_products: damagedProducts,
    });
  }

  totalResolvedIncidentDamage = roundMoney(totalResolvedIncidentDamage);

  const depositTotal = roundMoney(Number(order.deposit_total || 0));
  const depositUsed = roundMoney(Math.min(depositTotal, totalResolvedIncidentDamage));
  const refundedToWalletAmount = roundMoney(Math.max(0, depositTotal - depositUsed));

  const damageAfterDeposit = roundMoney(Math.max(0, totalResolvedIncidentDamage - depositUsed));

  let walletDebitAmount = 0;
  let outstandingAmount = damageAfterDeposit;
  let wallet = null;

  console.info(`${logPrefix} AmountCalculated`, {
    order_id: normalizedOrderId,
    resolved_incident_count: resolvedIncidents.length,
    resolved_damage_total: totalResolvedIncidentDamage,
    deposit_total: depositTotal,
    deposit_used: depositUsed,
    refunded_to_wallet_amount: refundedToWalletAmount,
    damage_after_deposit: damageAfterDeposit,
  });

  if (damageAfterDeposit > 0) {
    wallet = await getOrCreateWalletByUserId(order.user_id, session);

    const balanceBefore = roundMoney(Number(wallet.balance || 0));
    walletDebitAmount = roundMoney(Math.min(balanceBefore, damageAfterDeposit));
    const balanceAfter = roundMoney(balanceBefore - walletDebitAmount);
    outstandingAmount = roundMoney(damageAfterDeposit - walletDebitAmount);

    if (walletDebitAmount > 0) {
      wallet.balance = balanceAfter;
      await wallet.save({ session });

      console.info(`${logPrefix} WalletDebited`, {
        order_id: normalizedOrderId,
        user_id: String(order.user_id || ""),
        wallet_debit_amount: walletDebitAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      });

      const createdPenaltyTx = await Transaction.create(
        [
          {
            order_id: normalizedOrderId,
            amount: walletDebitAmount,
            currency: "VND",
            type: "PENALTY",
            method: "WALLET",
            status: "SUCCESS",
            provider_reference: "DEPOSIT_SETTLEMENT_INCIDENT_PENALTY",
          },
        ],
        { session }
      );

      await WalletTransaction.create(
        [
          {
            wallet_id: wallet.id,
            amount: walletDebitAmount,
            type: "PAYMENT",
            transaction_id: createdPenaltyTx[0].id,
            reference_id: normalizedOrderId,
            description: `Tru vi cho chi phi su co don ${normalizedOrderId}`,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
          },
        ],
        { session }
      );
    }
  }

  if (refundedToWalletAmount > 0) {
    wallet = wallet || (await getOrCreateWalletByUserId(order.user_id, session));

    const balanceBefore = roundMoney(Number(wallet.balance || 0));
    const balanceAfter = roundMoney(balanceBefore + refundedToWalletAmount);
    wallet.balance = balanceAfter;
    await wallet.save({ session });

    console.info(`${logPrefix} WalletRefunded`, {
      order_id: normalizedOrderId,
      user_id: String(order.user_id || ""),
      refunded_to_wallet_amount: refundedToWalletAmount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    const createdRefundTx = await Transaction.create(
      [
        {
          order_id: normalizedOrderId,
          amount: refundedToWalletAmount,
          currency: "VND",
          type: "REFUND",
          method: "WALLET",
          status: "SUCCESS",
          provider_reference: "DEPOSIT_SETTLEMENT_INCIDENT_REFUND",
        },
      ],
      { session }
    );

    await WalletTransaction.create(
      [
        {
          wallet_id: wallet.id,
          amount: refundedToWalletAmount,
          type: "REFUND",
          transaction_id: createdRefundTx[0].id,
          reference_id: normalizedOrderId,
          description: `Hoan coc don ${normalizedOrderId} sau doi soat su co`,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
        },
      ],
      { session }
    );
  }

  let settlementStatus = "REFUNDED";
  if (depositUsed > 0) {
    settlementStatus = depositUsed >= depositTotal ? "FORFEITED" : "PARTIALLY_FORFEITED";
  }

  const settledAt = new Date();
  const snapshot = {
    settled_at: settledAt,
    trigger,
    total_resolved_incident_damage: totalResolvedIncidentDamage,
    deposit_used: depositUsed,
    refunded_to_wallet_amount: refundedToWalletAmount,
    wallet_debit_amount: walletDebitAmount,
    outstanding_amount: outstandingAmount,
    incident_breakdown: incidentBreakdown,
  };

  order.deposit_settlement_status = settlementStatus;
  order.outstanding_damage_amount = outstandingAmount;
  order.deposit_settled_at = settledAt;
  order.deposit_settlement_snapshot = snapshot;
  await order.save({ session });

  console.info(`${logPrefix} OrderUpdated`, {
    order_id: normalizedOrderId,
    settlement_status: settlementStatus,
    outstanding_amount: outstandingAmount,
    settled_at: settledAt.toISOString(),
  });

  await debtService.recordOrderOutstandingDebt(
    {
      userId: order.user_id,
      orderId: normalizedOrderId,
      outstandingAmount,
      incidentBreakdown,
      trigger,
      dueAt: settledAt,
      settledAt,
    },
    session,
  );

  console.info(`${logPrefix} DebtSynced`, {
    order_id: normalizedOrderId,
    outstanding_amount: outstandingAmount,
    incident_count: incidentBreakdown.length,
  });

  console.info(`${logPrefix} Done`, {
    order_id: normalizedOrderId,
    settlement_status: settlementStatus,
  });

  return {
    settled: true,
    order_id: normalizedOrderId,
    summary: {
      booking_order_id: normalizedOrderId,
      deposit_total: depositTotal,
      total_resolved_incident_damage: totalResolvedIncidentDamage,
      deposit_deducted_value: depositUsed,
      refunded_to_wallet_amount: refundedToWalletAmount,
      wallet_debit_amount: walletDebitAmount,
      outstanding_amount: outstandingAmount,
      deposit_settlement_status: settlementStatus,
      incident_breakdown: incidentBreakdown,
    },
  };
};

exports.settleOrderDepositAfterIncidents = async ({ orderId, trigger = "SYSTEM" } = {}) => {
  let settlementResult = null;
  const session = await mongoose.startSession();
  const logPrefix = "[DepositSettlement][Incident]";

  try {
    console.info(`${logPrefix} TransactionStart`, {
      order_id: String(orderId || "").trim() || null,
      trigger,
    });

    await session.withTransaction(async () => {
      settlementResult = await settleOrderDepositAfterIncidentsInternal({ orderId, trigger, session });
    });

    console.info(`${logPrefix} TransactionCommitted`, {
      order_id: String(orderId || "").trim() || null,
      settled: Boolean(settlementResult?.settled),
      reason: settlementResult?.reason || null,
    });
  } catch (error) {
    console.error(`${logPrefix} TransactionFailed`, {
      order_id: String(orderId || "").trim() || null,
      trigger,
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    await session.endSession();
  }

  if (settlementResult?.settled && settlementResult?.summary) {
    const order = await resolveOrderById(orderId);
    if (order?.user_id) {
      const summary = settlementResult.summary;
      await notificationService.sendToUser(order.user_id, {
        title: "Đã xử lý xong khoản đặt cọc của bạn",
        message: `Đơn ${summary.booking_order_id} đã đối soát cọc. Tổng tiền hư hại: ${Number(summary.total_resolved_incident_damage || 0).toLocaleString("vi-VN")} VND, hoàn: ${Number(summary.refunded_to_wallet_amount || 0).toLocaleString("vi-VN")} VND, trừ cọc: ${Number(summary.deposit_deducted_value || 0).toLocaleString("vi-VN")} VND, trừ ví: ${Number(summary.wallet_debit_amount || 0).toLocaleString("vi-VN")} VND, công nợ: ${Number(summary.outstanding_amount || 0).toLocaleString("vi-VN")} VND.`,
        type: "PAYMENT",
        event_code: "PAYMENT_DEPOSIT_SETTLEMENT_COMPLETED",
        dedupe_key: `PAYMENT_DEPOSIT_SETTLEMENT_COMPLETED:${summary.booking_order_id}:${String(order.deposit_settled_at || "")}`,
        data: {
          type: "PAYMENT_DEPOSIT_SETTLEMENT_COMPLETED",
          order_id: summary.booking_order_id,
          trigger,
          deposit_total: String(summary.deposit_total || 0),
          deposit_deducted_value: String(summary.deposit_deducted_value || 0),
          refunded_to_wallet_amount: String(summary.refunded_to_wallet_amount || 0),
          wallet_debit_amount: String(summary.wallet_debit_amount || 0),
          outstanding_amount: String(summary.outstanding_amount || 0),
          deposit_settlement_status: String(summary.deposit_settlement_status || ""),
          total_resolved_incident_damage: String(summary.total_resolved_incident_damage || 0),
          incident_breakdown: summary.incident_breakdown || [],
        },
      });
    }
  }

  return settlementResult;
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
    status: { $in: ["ASSIGNED", "CHECKED_IN"] },
    start_date: { $lte: now },
    end_date: { $gte: now },
  })
    .select("staff_id")
    .lean();

  const assignmentStaffIds = [...new Set(assignments.map((entry) => String(entry.staff_id || "")).filter(Boolean))];
  
  if (!assignmentStaffIds.length) {
    const allManagers = await User.find({ role: "manager", isActive: true })
      .select("_id")
      .lean();
    return [...new Set(allManagers.map((m) => String(m._id || "")).filter(Boolean))];
  }

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
      console.info(`${logPrefix} TriggerSettlement`, {
        incident_id: String(incident.id || incidentId || ""),
        order_id: String(booking.order_id),
        trigger: `INCIDENT_${normalizedStatus}`,
      });

      const settlementResult = await exports.settleOrderDepositAfterIncidents({
        orderId: booking.order_id,
        trigger: `INCIDENT_${normalizedStatus}`,
      });

      console.info(`${logPrefix} SettlementResult`, {
        incident_id: String(incident.id || incidentId || ""),
        order_id: String(booking.order_id),
        settled: Boolean(settlementResult?.settled),
        reason: settlementResult?.reason || null,
        has_summary: Boolean(settlementResult?.summary),
      });

      if (settlementResult?.summary) {
        damageBilling.booking_order_id = settlementResult.summary.booking_order_id;
        damageBilling.user_deposit_value = settlementResult.summary.deposit_total;
        damageBilling.deposit_deducted_value = settlementResult.summary.deposit_deducted_value;
        damageBilling.total_amount_value = settlementResult.summary.outstanding_amount;
        damageBilling.refunded_to_wallet_amount = settlementResult.summary.refunded_to_wallet_amount;
        damageBilling.settlement_applied = true;
        damageBilling.settlement_reason = null;
      } else {
        damageBilling.booking_order_id = booking.order_id;
        damageBilling.settlement_applied = false;
        damageBilling.settlement_reason = settlementResult?.reason || "SETTLEMENT_NOT_APPLIED";
      }
    } else {
      console.warn(`${logPrefix} SkipSettlement`, {
        incident_id: String(incident.id || incidentId || ""),
        reason: "BOOKING_ORDER_NOT_FOUND",
        booking_id: String(incident.booking_id || ""),
      });

      damageBilling.settlement_applied = false;
      damageBilling.settlement_reason = "BOOKING_ORDER_NOT_FOUND";
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

