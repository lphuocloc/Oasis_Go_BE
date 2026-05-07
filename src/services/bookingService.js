const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const BookingAccessSession = require("../models/BookingAccessSession");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const OnlineKey = require("../models/OnlineKey");
const PodQrCode = require("../models/PodQrCode");
const {
  autoAssignTaskForBooking,
  cancelOpenTasksForNoShowBooking,
} = require("./cleaningTaskService");
const notificationService = require("./notificationService");
const adminLedgerService = require("./adminLedgerService");
const { emitPodCheckinConfirmed } = require("../socket/socketServer");

const readEnvMinutes = (key, fallback, min = 0) => {
  const raw = Number(process.env[key]);
  if (Number.isFinite(raw) && raw >= min) {
    return raw;
  }
  return fallback;
};

const AUTO_ACTIVATE_GRACE_PERIOD_MINUTES = readEnvMinutes("BOOKING_AUTO_ACTIVATE_GRACE_MINUTES", 15, 1);
const CLEANER_POST_CHECKOUT_WINDOW_MINUTES = 30;
const CHECKOUT_REMINDER_LEAD_MINUTES = 15;
const CHECKIN_EARLY_WINDOW_MINUTES = readEnvMinutes("BOOKING_CHECKIN_EARLY_WINDOW_MINUTES", 15, 0);
const CHECKIN_LATE_WINDOW_MINUTES = readEnvMinutes("BOOKING_CHECKIN_LATE_WINDOW_MINUTES", 15, 0);
const CHECKIN_EARLY_WINDOW_MS = CHECKIN_EARLY_WINDOW_MINUTES * 60 * 1000;
const CHECKIN_LATE_WINDOW_MS = CHECKIN_LATE_WINDOW_MINUTES * 60 * 1000;
const POD_TYPE_STANDARD = "STANDARD";
const POD_TYPE_SERVICE = "SERVICE";
const POD_DETAILS_SELECT =
  "id cluster_id code name description status maintenance_status " +
  "soundproof_level ventilation_level power_outlets wifi_available " +
  "max_session_duration last_cleaned_at createdAt updatedAt";

class BookingService {
  _normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  }

  _normalizePodType(type) {
    return String(type || "").trim().toUpperCase();
  }

  _isPodTypeAllowedForRole(role, podType) {
    const normalizedRole = this._normalizeRole(role);
    const normalizedType = this._normalizePodType(podType);

    if (normalizedRole === "user") {
      return normalizedType === POD_TYPE_STANDARD;
    }

    return [POD_TYPE_STANDARD, POD_TYPE_SERVICE].includes(normalizedType);
  }

  _buildPodTypeNotAllowedError(role, podType) {
    const normalizedRole = this._normalizeRole(role) || "unknown";
    const normalizedType = this._normalizePodType(podType) || "UNKNOWN";
    const error = new Error(
      `Role ${normalizedRole} is not allowed to use pod type ${normalizedType} for booking`
    );
    error.statusCode = 403;
    error.errorCode = "POD_TYPE_NOT_ALLOWED_FOR_ROLE";
    return error;
  }

  _createError(message, statusCode, errorCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.errorCode = errorCode;
    return error;
  }

  async _recordRevenueIfOrderCompleted(orderId) {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return null;

    const order = await BookingOrder.findOne({ id: normalizedOrderId })
      .select("id status user_id payable_total_price final_total_price")
      .lean();
    if (!order) return null;

    const status = String(order.status || "").toUpperCase();
    if (!["PAID", "PARTIAL_CANCEL"].includes(status)) {
      return null;
    }

    const remainingActive = await Booking.countDocuments({
      order_id: normalizedOrderId,
      status: { $in: ["BOOKED", "IN_USE"] },
    });

    if (remainingActive > 0) {
      return null;
    }

    const amount = Number(order.payable_total_price ?? order.final_total_price ?? 0);

    return adminLedgerService.createEntry({
      type: "REVENUE_RECOGNIZED",
      amount,
      source: "ORDER_COMPLETED",
      dedupe_key: `REVENUE_RECOGNIZED:${normalizedOrderId}`,
      user_id: String(order.user_id || ""),
      order_id: normalizedOrderId,
      reference_id: normalizedOrderId,
      description: `Revenue recognized for completed order ${normalizedOrderId}`,
    });
  }

  async _revokeCleanerKeysForBooking(bookingId) {
    if (!bookingId) return;
    await OnlineKey.updateMany(
      {
        booking_id: String(bookingId),
        key_type: "CLEANER",
        is_revoked: false,
      },
      {
        $set: { is_revoked: true },
      }
    );
  }

  async _tryAutoAssignCleaningTask(booking, trigger = "UNKNOWN") {
    if (!booking) return;

    try {
      await autoAssignTaskForBooking(booking, { trigger });
    } catch (error) {
      console.error(
        `Auto assign cleaning task failed (trigger=${trigger}, booking_id=${booking.id || "unknown"}):`,
        error.message || error
      );
    }
  }

  async autoActivateOverdueCheckins(graceMinutes = AUTO_ACTIVATE_GRACE_PERIOD_MINUTES) {
    const graceMs = Math.max(1, Number(graceMinutes) || AUTO_ACTIVATE_GRACE_PERIOD_MINUTES) * 60 * 1000;
    const now = Date.now();
    const thresholdDate = new Date(now - graceMs);

    const candidateBookings = await Booking.find({
      status: "BOOKED",
      checkin_state: { $in: ["PENDING", null] },
      start_time: { $lte: thresholdDate },
      end_time: { $gt: new Date(now) },
    }).select("id user_id pod_id order_id start_time end_time status checkin_state");

    if (candidateBookings.length === 0) {
      return { found: 0, auto_activated: 0 };
    }

    const orderIds = [...new Set(candidateBookings.map((booking) => booking.order_id).filter(Boolean))];
    const eligibleOrders = await BookingOrder.find({
      id: { $in: orderIds },
      status: { $in: ["PAID", "PARTIAL_CANCEL"] },
    }).select("id");

    const eligibleOrderIdSet = new Set(eligibleOrders.map((order) => order.id));
    const overdueBookings = candidateBookings.filter((booking) => eligibleOrderIdSet.has(booking.order_id));

    if (overdueBookings.length === 0) {
      return { found: candidateBookings.length, auto_activated: 0 };
    }

    let autoActivatedCount = 0;

    for (const booking of overdueBookings) {
      const updated = await Booking.updateOne(
        {
          id: booking.id,
          status: "BOOKED",
          checkin_state: { $in: ["PENDING", null] },
        },
        {
          $set: {
            status: "IN_USE",
            checkin_state: "AUTO_ACTIVATED",
            auto_activated_at: new Date(),
            no_show_marked_at: null,
            checked_in_at: null,
            checkin_source: "SYSTEM_AUTO",
          },
        }
      );

      if (updated.modifiedCount !== 1) {
        continue;
      }

      autoActivatedCount += 1;

      // Create booking access session for auto check-in
      const autoActivatedAt = new Date();
      await BookingAccessSession.create({
        booking_id: booking.id,
        pod_id: booking.pod_id,
        user_id: booking.user_id,
        checkin_at: autoActivatedAt,
        checkin_source: "AUTO",
        access_reason: "BOOKING",
        key_type: "SYSTEM",
      });

      await notificationService.sendToUser(booking.user_id, {
        title: "Phiên sử dụng đã tự động kích hoạt",
        message: "Bạn chưa check-in đúng giờ, hệ thống đã tự động kích hoạt phiên sử dụng của bạn.",
        type: "BOOKING",
        event_code: "BOOKING_AUTO_CHECKIN",
        dedupe_key: `BOOKING_AUTO_CHECKIN:${booking.id}`,
        data: {
          type: "BOOKING_AUTO_CHECKIN",
          booking_id: booking.id,
          order_id: booking.order_id,
          pod_id: booking.pod_id,
        },
      });
    }

    return {
      found: overdueBookings.length,
      auto_activated: autoActivatedCount,
      grace_minutes: Math.max(1, Number(graceMinutes) || AUTO_ACTIVATE_GRACE_PERIOD_MINUTES),
    };
  }

  async markNoShowForExpiredAutoActivatedBookings() {
    const now = new Date();

    const expiredAutoActivatedBookings = await Booking.find({
      status: "IN_USE",
      checkin_state: "AUTO_ACTIVATED",
      end_time: { $lte: now },
    }).select("id user_id pod_id order_id end_time");

    if (expiredAutoActivatedBookings.length === 0) {
      return { found: 0, no_show_marked: 0 };
    }

    let markedCount = 0;
    const affectedOrderIds = new Set();

    for (const booking of expiredAutoActivatedBookings) {
      const updated = await Booking.updateOne(
        {
          id: booking.id,
          status: "IN_USE",
          checkin_state: "AUTO_ACTIVATED",
        },
        {
          $set: {
            status: "COMPLETED",
            actual_end_time: booking.end_time || now,
            checkin_state: "NO_SHOW",
            no_show_marked_at: new Date(),
            cleaner_access_allowed: false,
            cleaner_access_updated_at: new Date(),
          },
        }
      );

      if (updated.modifiedCount !== 1) {
        continue;
      }

      markedCount += 1;
      if (booking.order_id) {
        affectedOrderIds.add(String(booking.order_id));
      }

      await OnlineKey.updateMany(
        {
          booking_id: booking.id,
          key_type: "CLEANER",
          is_revoked: false,
        },
        {
          $set: { is_revoked: true },
        }
      );

      // Cancel all open cleaning tasks for this booking
      await cancelOpenTasksForNoShowBooking(booking.id);

      await notificationService.sendToUser(booking.user_id, {
        title: "Phiên sử dụng kết thúc do không check-in",
        message: "Phiên sử dụng của bạn đã hết giờ và được ghi nhận là NO_SHOW.",
        type: "BOOKING",
        event_code: "BOOKING_NO_SHOW",
        dedupe_key: `BOOKING_NO_SHOW:${booking.id}`,
        data: {
          type: "BOOKING_NO_SHOW",
          booking_id: booking.id,
          order_id: booking.order_id,
          pod_id: booking.pod_id,
        },
      });
    }

    if (affectedOrderIds.size > 0) {
      for (const orderId of affectedOrderIds) {
        try {
          await this._recordRevenueIfOrderCompleted(orderId);
        } catch (error) {
          console.error("Failed to record revenue for completed order", error);
        }
      }
    }

    return {
      found: expiredAutoActivatedBookings.length,
      no_show_marked: markedCount,
    };
  }

  async autoCheckoutExpiredBookings() {
    const now = new Date();

    // AUTO_ACTIVATED bookings are handled by NO_SHOW flow, not auto-checkout.
    // This avoids state races when both jobs run in parallel.
    const expiredBookings = await Booking.find({
      status: "IN_USE",
      checkin_state: { $ne: "AUTO_ACTIVATED" },
      end_time: { $lte: now },
    }).select("id user_id pod_id order_id start_time end_time status");

    if (expiredBookings.length === 0) {
      return { found: 0, auto_checked_out: 0, access_logs_updated: 0 };
    }

    let autoCheckedOutCount = 0;
    let accessLogsUpdatedCount = 0;
    const affectedOrderIds = new Set();

    for (const booking of expiredBookings) {
      const updated = await Booking.updateOne(
        {
          id: booking.id,
          status: "IN_USE",
        },
        {
          $set: {
            status: "COMPLETED",
            actual_end_time: booking.end_time || now,
            cleaner_access_allowed: true,
            cleaner_access_updated_at: new Date(),
          },
        }
      );

      if (updated.modifiedCount !== 1) {
        continue;
      }

      autoCheckedOutCount += 1;
      if (booking.order_id) {
        affectedOrderIds.add(String(booking.order_id));
      }

      // Update booking access session with timeout checkout
      const accessSessionUpdate = await BookingAccessSession.updateOne(
        {
          booking_id: booking.id,
          checkin_at: { $ne: null },
          checkout_at: null, // Only update if not already checked out
        },
        {
          $set: {
            checkout_at: booking.end_time || now,
            checkout_type: "TIMEOUT",
          },
        }
      );

      if (accessSessionUpdate.modifiedCount === 1) {
        accessLogsUpdatedCount += 1;
      }

      await notificationService.sendToUser(booking.user_id, {
        title: "Phiên sử dụng đã tự động checkout",
        message: "Hệ thống đã tự động checkout do phiên sử dụng đã hết thời gian.",
        type: "BOOKING",
        event_code: "BOOKING_AUTO_CHECKOUT",
        dedupe_key: `BOOKING_AUTO_CHECKOUT:${booking.id}`,
        data: {
          type: "BOOKING_AUTO_CHECKOUT",
          booking_id: booking.id,
          order_id: booking.order_id,
          pod_id: booking.pod_id,
          checkout_type: "TIMEOUT",
        },
      });
    }

    if (affectedOrderIds.size > 0) {
      for (const orderId of affectedOrderIds) {
        try {
          await this._recordRevenueIfOrderCompleted(orderId);
        } catch (error) {
          console.error("Failed to record revenue for completed order", error);
        }
      }
    }

    return {
      found: expiredBookings.length,
      auto_checked_out: autoCheckedOutCount,
      access_logs_updated: accessLogsUpdatedCount,
    };
  }

  async notifyUpcomingCheckoutBookings(leadMinutes = CHECKOUT_REMINDER_LEAD_MINUTES) {
    const safeLeadMinutes = Math.max(1, Number(leadMinutes) || CHECKOUT_REMINDER_LEAD_MINUTES);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + safeLeadMinutes * 60 * 1000);

    // Only remind bookings that were manually checked in by user.
    const upcomingBookings = await Booking.find({
      status: "IN_USE",
      checkin_state: "MANUAL_CHECKED_IN",
      end_time: { $gt: now, $lte: windowEnd },
    }).select("id user_id pod_id order_id end_time checkin_state status");

    if (upcomingBookings.length === 0) {
      return { found: 0, reminded: 0, failed: 0, lead_minutes: safeLeadMinutes };
    }

    let remindedCount = 0;
    let failedCount = 0;

    for (const booking of upcomingBookings) {
      try {
        await notificationService.sendToUser(booking.user_id, {
          title: "Nhắc nhở sắp checkout",
          message: `Phiên sử dụng sẽ kết thúc trong khoảng ${safeLeadMinutes} phút nữa. Vui lòng chuẩn bị checkout đúng giờ.`,
          type: "BOOKING",
          event_code: "BOOKING_REMINDER",
          dedupe_key: `BOOKING_CHECKOUT_REMINDER_${safeLeadMinutes}M:${booking.id}`,
          data: {
            type: "BOOKING_CHECKOUT_REMINDER",
            booking_id: booking.id,
            order_id: booking.order_id,
            pod_id: booking.pod_id,
            end_time: booking.end_time,
            minutes_left: String(safeLeadMinutes),
            reminder_type: `CHECKOUT_${safeLeadMinutes}M`,
          },
        });

        remindedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(
          `Checkout reminder notification failed (booking_id=${booking.id || "unknown"}):`,
          error.message || error
        );
      }
    }

    return {
      found: upcomingBookings.length,
      reminded: remindedCount,
      failed: failedCount,
      lead_minutes: safeLeadMinutes,
    };
  }

  startAutoActivateCheckinJob(intervalMinutes = 1, graceMinutes = AUTO_ACTIVATE_GRACE_PERIOD_MINUTES) {
    const safeIntervalMinutes = Math.max(1, Number(intervalMinutes) || 1);

    console.log(
      `Starting auto-activate checkin job (interval: ${safeIntervalMinutes} minute(s), grace: ${graceMinutes} minute(s))`
    );

    Promise.all([
      this.autoActivateOverdueCheckins(graceMinutes),
      this.markNoShowForExpiredAutoActivatedBookings(),
      this.autoCheckoutExpiredBookings(),
      this.notifyUpcomingCheckoutBookings(CHECKOUT_REMINDER_LEAD_MINUTES),
    ]).catch((error) => {
      console.error("Initial auto-activate checkin job failed:", error);
    });

    setInterval(async () => {
      try {
        await Promise.all([
          this.autoActivateOverdueCheckins(graceMinutes),
          this.markNoShowForExpiredAutoActivatedBookings(),
          this.autoCheckoutExpiredBookings(),
          this.notifyUpcomingCheckoutBookings(CHECKOUT_REMINDER_LEAD_MINUTES),
        ]);
      } catch (error) {
        console.error("Auto-activate checkin job error:", error);
      }
    }, safeIntervalMinutes * 60 * 1000);
  }

  _getAllowedKeyTypesByRole(viewerRole = null) {
    const normalizedRole = String(viewerRole || "").toLowerCase();

    if (normalizedRole === "user") {
      return ["CUSTOMER"];
    }

    if (normalizedRole === "cleaner") {
      return ["CLEANER"];
    }

    return null;
  }

  _mapKeyRole(keyType = "") {
    const normalized = String(keyType).toUpperCase();
    if (normalized === "CUSTOMER") return "customer";
    if (normalized === "CLEANER") return "cleaner";
    return "manager";
  }

  _resolveCleanerKeyWindow({ booking, now = new Date() }) {
    const validFrom = booking?.start_time
      ? new Date(new Date(booking.start_time).getTime() - CHECKIN_EARLY_WINDOW_MS)
      : now;
    const validTo = booking?.end_time
      ? new Date(
        Math.max(
          new Date(booking.end_time).getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000,
          now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000
        )
      )
      : new Date(now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000);

    return { validFrom, validTo };
  }

  async _reconcileCleanerKeyWindow(cleanerKey, booking, now = new Date()) {
    if (!cleanerKey) return cleanerKey;

    const { validFrom, validTo } = this._resolveCleanerKeyWindow({ booking, now });
    const currentValidFrom = new Date(cleanerKey.valid_from || validFrom);
    const currentValidTo = new Date(cleanerKey.valid_to || validTo);

    const nextValidFrom = new Date(Math.min(currentValidFrom.getTime(), validFrom.getTime()));
    const nextValidTo = new Date(Math.max(currentValidTo.getTime(), validTo.getTime()));

    if (
      nextValidFrom.getTime() !== currentValidFrom.getTime() ||
      nextValidTo.getTime() !== currentValidTo.getTime()
    ) {
      cleanerKey.valid_from = nextValidFrom;
      cleanerKey.valid_to = nextValidTo;
      await cleanerKey.save();
    }

    return cleanerKey;
  }

  async _attachOnlineKeys(bookings = [], viewerRole = null) {
    if (!Array.isArray(bookings) || bookings.length === 0) {
      return bookings;
    }

    const bookingIds = [...new Set(bookings.map((booking) => String(booking.id)).filter(Boolean))];
    if (bookingIds.length === 0) {
      return bookings;
    }

    const allowedKeyTypes = this._getAllowedKeyTypesByRole(viewerRole);
    const keyQuery = { booking_id: { $in: bookingIds } };
    if (allowedKeyTypes) {
      keyQuery.key_type = { $in: allowedKeyTypes };
    }

    const onlineKeys = await OnlineKey.find(keyQuery)
      .sort({ createdAt: -1 })
      .select("id booking_id key_type key_token valid_from valid_to is_revoked");

    const keyMap = onlineKeys.reduce((map, key) => {
      const bookingId = String(key.booking_id);
      if (!map[bookingId]) map[bookingId] = [];
      if (map[bookingId].some((existing) => existing.key_type === key.key_type)) {
        return map;
      }

      const keyData = typeof key.toObject === "function" ? key.toObject() : key;
      map[bookingId].push({
        ...keyData,
        role: this._mapKeyRole(keyData.key_type),
      });
      return map;
    }, {});

    return bookings.map((booking) => {
      const plainBooking = typeof booking.toObject === "function" ? booking.toObject() : booking;
      return {
        ...plainBooking,
        online_keys: keyMap[String(plainBooking.id)] || [],
      };
    });
  }

  /**
   * Create a new booking
   * @param {Object} bookingData - Booking data
   * @returns {Promise<Object>} Created booking
   */
  async createBooking(bookingData, actor = null) {
    const {
      order_id,
      user_id,
      pod_id,
      start_time,
      end_time,
      base_price,
      total_price,
    } = bookingData;

    // Validate order exists
    const order = await BookingOrder.findOne({ id: order_id });
    if (!order) {
      throw new Error("Order not found");
    }

    // Validate user exists
    const user = await User.findById(user_id);
    if (!user) {
      throw new Error("User not found");
    }

    // Validate pod exists
    const pod = await Pod.findOne({ id: pod_id });
    if (!pod) {
      throw new Error("Pod not found");
    }

    if (!this._isPodTypeAllowedForRole(actor?.role, pod.type)) {
      throw this._buildPodTypeNotAllowedError(actor?.role, pod.type);
    }

    // Check pod availability
    const isAvailable = await Booking.isPodAvailable(
      pod_id,
      start_time,
      end_time
    );
    if (!isAvailable) {
      throw new Error("Pod is not available for the selected time slot");
    }

    // Create booking
    const booking = new Booking({
      order_id,
      user_id,
      pod_id,
      start_time,
      end_time,
      base_price,
      total_price,
      status: "BOOKED",
    });

    await booking.save();
    await this._tryAutoAssignCleaningTask(booking, "BOOKING_CREATED");
    return booking;
  }

  /**
   * Get all bookings with filters (with optional pagination)
   * @param {Object} filters - Filter options (user_id, pod_id, order_id, status, start_date, end_date, page, limit)
   * @returns {Promise<Object>} List of bookings with pagination (if page/limit provided)
   */
  async getAllBookings(filters = {}) {
    const {
      user_id,
      pod_id,
      pod_ids,
      order_id,
      status,
      start_date,
      end_date,
      page,
      limit,
    } = filters;

    const query = {};

    if (user_id) query.user_id = user_id;
    if (pod_id) query.pod_id = pod_id;
    if (pod_ids) {
      const ids = Array.isArray(pod_ids)
        ? pod_ids
        : String(pod_ids)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      query.pod_id = { $in: ids };
    }
    if (order_id) query.order_id = order_id;
    if (status) {
      const statusValues = (Array.isArray(status) ? status : String(status).split(","))
        .map((item) => String(item || "").trim().toUpperCase())
        .filter(Boolean);

      const hasAllStatus = statusValues.includes("ALL");
      if (!hasAllStatus && statusValues.length > 0) {
        query.status = statusValues.length === 1 ? statusValues[0] : { $in: statusValues };
      }
    }

    if (start_date || end_date) {
      query.start_time = {};
      if (start_date) query.start_time.$gte = new Date(start_date);
      if (end_date) query.start_time.$lte = new Date(end_date);
    }

    // If no pagination params, return all results
    if (!page && !limit) {
      const bookings = await Booking.find(query)
        .sort({ createdAt: -1 })
        .populate("user", "id name email phone")
        .populate("pod", "id name description status")
        .populate("order", "id final_total_price payable_total_price deposit_total deposit_settlement_status status");
      return { bookings };
    }

    // With pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("user", "id name email phone")
        .populate("pod", "id name description status")
        .populate("order", "id final_total_price payable_total_price deposit_total deposit_settlement_status status"),
      Booking.countDocuments(query),
    ]);

    return {
      bookings,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum,
      },
    };
  }

  /**
   * Get booking by ID
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} Booking details
   */
  async getBookingById(bookingId, viewerRole = null) {
    const booking = await Booking.findOne({ id: bookingId })
      .select(
        "id order_id user_id pod_id start_time end_time actual_end_time status " +
        "cleaner_access_allowed cleaner_access_updated_at checkin_state checked_in_at checkin_source auto_activated_at no_show_marked_at " +
        "base_price total_price createdAt updatedAt"
      )
      .populate("pod", POD_DETAILS_SELECT)
      .populate("order", "id final_total_price payable_total_price deposit_total deposit_settlement_status status payment_method");

    if (!booking) {
      throw new Error("Booking not found");
    }

    const [bookingWithKeys] = await this._attachOnlineKeys([booking], viewerRole);
    return bookingWithKeys || booking;
  }

  /**
   * Get cleaner online key for current authenticated cleaner by booking ID
   * @param {String} bookingId - Booking ID
   * @param {Object} actor - Authenticated user
   * @returns {Promise<Object>} Cleaner online key payload
   */
  async getMyCleanerKeyByBookingId(bookingId, actor) {
    const actorRole = String(actor?.role || "").toLowerCase();
    const actorId = String(actor?._id || actor?.id || "");

    if (!actorId) {
      const error = new Error("Không xác định được người dùng hiện tại");
      error.statusCode = 401;
      throw error;
    }

    if (actorRole !== "cleaner") {
      const error = new Error("Chỉ cleaner mới được lấy cleaner key của chính mình");
      error.statusCode = 403;
      throw error;
    }

    const booking = await Booking.findOne({ id: bookingId }).select(
      "id status checkin_state cleaner_access_allowed start_time end_time"
    );
    if (!booking) {
      const error = new Error("Booking not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(booking.checkin_state || "").toUpperCase() === "NO_SHOW") {
      const error = new Error("Không được phép lấy cleaner key cho booking NO_SHOW");
      error.statusCode = 403;
      throw error;
    }


    const cleanerKey = await OnlineKey.findOne({
      booking_id: String(bookingId),
      key_type: "CLEANER",
      user_id: actorId,
      is_revoked: false,
    })
      .sort({ createdAt: -1 })
      .select("id booking_id pod_id user_id key_type key_token valid_from valid_to is_revoked createdAt updatedAt");

    if (!booking.cleaner_access_allowed && String(cleanerKey?.pod_id || "") === String(booking.pod_id || "")) {
      const error = new Error("Chủ nhân phòng chưa cho phép truy cập làm vệ sinh");
      error.statusCode = 403;
      throw error;
    }

    if (!cleanerKey) {
      const error = new Error("Không tìm thấy cleaner key cho booking này");
      error.statusCode = 404;
      throw error;
    }

    await this._reconcileCleanerKeyWindow(cleanerKey, booking, new Date());

    const keyData = typeof cleanerKey.toObject === "function" ? cleanerKey.toObject() : cleanerKey;

    return {
      booking_id: String(booking.id),
      booking_status: booking.status,
      booking_checkin_state: booking.checkin_state,
      online_key: {
        ...keyData,
        role: "cleaner",
      },
    };
  }

  /**
   * Get bookings by user
   * @param {String} userId - User ID
   * @param {String} status - Optional status filter
   * @returns {Promise<Array>} User's bookings
   */
  async getBookingsByUser(userId, status = null, viewerRole = null) {
    const bookings = await Booking.getByUser(userId, status);
    return await this._attachOnlineKeys(bookings, viewerRole);
  }

  /**
   * Get bookings by pod
   * @param {String} podId - Pod ID
   * @param {String} status - Optional status filter
   * @returns {Promise<Array>} Pod's bookings
   */
  async getBookingsByPod(podId, status = null) {
    return await Booking.getByPod(podId, status);
  }

  /**
   * Get bookings by order
   * @param {String} orderId - Order ID
   * @returns {Promise<Array>} Order's bookings
   */
  async getBookingsByOrder(orderId, viewerRole = null) {
    const bookings = await Booking.find({ order_id: orderId })
      .sort({ start_time: 1 })
      .populate("pod", POD_DETAILS_SELECT);
    return await this._attachOnlineKeys(bookings, viewerRole);
  }

  /**
   * Update booking
   * @param {String} bookingId - Booking ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated booking
   */
  async updateBooking(bookingId, updateData) {
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    if (
      updateData.cleaner_access_allowed !== undefined &&
      typeof updateData.cleaner_access_allowed !== "boolean"
    ) {
      const error = new Error("cleaner_access_allowed must be boolean");
      error.statusCode = 400;
      throw error;
    }

    const nextCheckinStateRaw =
      updateData.checkin_state !== undefined ? updateData.checkin_state : booking.checkin_state;
    const nextCheckinState = String(nextCheckinStateRaw || "").toUpperCase();
    const nextCleanerAccessAllowed =
      updateData.cleaner_access_allowed !== undefined
        ? updateData.cleaner_access_allowed
        : booking.cleaner_access_allowed;

    if (nextCheckinState === "NO_SHOW" && nextCleanerAccessAllowed === true) {
      const error = new Error("Cannot enable cleaner access for NO_SHOW booking");
      error.statusCode = 400;
      throw error;
    }

    if (nextCheckinState === "NO_SHOW") {
      updateData.cleaner_access_allowed = false;
      if (updateData.cleaner_access_updated_at === undefined) {
        updateData.cleaner_access_updated_at = new Date();
      }
      if (updateData.no_show_marked_at === undefined) {
        updateData.no_show_marked_at = new Date();
      }
    }

    const previousCleanerAccessAllowed = booking.cleaner_access_allowed;

    // Don't allow updating certain fields if booking is completed or cancelled
    if (["COMPLETED", "CANCELLED"].includes(booking.status)) {
      throw new Error(
        `Cannot update booking with status ${booking.status}`
      );
    }

    // If updating time, check availability
    if (updateData.start_time || updateData.end_time) {
      const start = updateData.start_time || booking.start_time;
      const end = updateData.end_time || booking.end_time;

      const isAvailable = await Booking.isPodAvailable(
        booking.pod_id,
        start,
        end,
        bookingId
      );

      if (!isAvailable) {
        throw new Error("Pod is not available for the selected time slot");
      }
    }

    // Update fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] !== undefined) {
        booking[key] = updateData[key];
      }
    });

    await booking.save();

    // NO_SHOW has highest priority: cleaner access must be blocked and keys revoked.
    if (String(booking.checkin_state || "").toUpperCase() === "NO_SHOW") {
      await this._revokeCleanerKeysForBooking(booking.id);
    }

    if (!previousCleanerAccessAllowed && booking.cleaner_access_allowed === true) {
      await this._tryAutoAssignCleaningTask(booking, "BOOKING_UPDATED_CLEANER_ACCESS_TRUE");
    }

    return booking;
  }

  /**
   * Start using pod (change status from BOOKED to IN_USE)
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} Updated booking
   */


  /**
   * Checkin business rules:
   * - CUSTOMER: Uses qr_token only (online key is not required for check-in)
   * - CLEANER: Uses key_token only for cleaner access check-in
   * @param {Object} params
   * @returns {Promise<Object>} Updated booking or booking info
   */
  async checkinWithQrAndKey({ qr_token, key_token, actor }) {
    const actorId = String(actor?._id || actor?.id || "");
    if (!actorId) {
      const error = new Error("Không xác định được người dùng hiện tại");
      error.statusCode = 401;
      throw error;
    }

    const now = new Date();
    // ============= CUSTOMER CHECK-IN (QR ONLY) =============
    if (qr_token) {
      const qrCode = await PodQrCode.findOne({ qr_token, is_active: true });
      if (!qrCode) {
        const error = new Error("QR code không hợp lệ hoặc không hoạt động");
        error.statusCode = 404;
        throw error;
      }

      if (new Date(qrCode.expires_at).getTime() < Date.now()) {
        const error = new Error("QR code đã hết hạn");
        error.statusCode = 403;
        throw error;
      }

      const candidateBookings = await Booking.find({
        user_id: actorId,
        pod_id: String(qrCode.pod_id),
        status: { $in: ["BOOKED", "IN_USE"] },
      }).sort({ start_time: -1, createdAt: -1 });

      if (!candidateBookings.length) {
        const error = new Error("Không tìm thấy booking hợp lệ để check-in");
        error.statusCode = 404;
        throw error;
      }

      const nowMs = now.getTime();
      const inUseBooking = candidateBookings.find((item) => item.status === "IN_USE");
      const bookedInWindow = candidateBookings
        .filter((item) => {
          if (item.status !== "BOOKED") return false;
          const startMs = new Date(item.start_time).getTime();
          return nowMs >= startMs - CHECKIN_EARLY_WINDOW_MS && nowMs <= startMs + CHECKIN_LATE_WINDOW_MS;
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
      const latestPastBooked = candidateBookings.find((item) => {
        if (item.status !== "BOOKED") return false;
        return new Date(item.start_time).getTime() <= nowMs;
      });
      const earliestFutureBooked = [...candidateBookings]
        .filter((item) => item.status === "BOOKED" && new Date(item.start_time).getTime() > nowMs)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];

      // Priority: valid check-in window booking -> active session -> nearest past booking -> nearest future booking.
      const booking =
        bookedInWindow ||
        inUseBooking ||
        latestPastBooked ||
        earliestFutureBooked ||
        candidateBookings[0];

      if (booking.checkin_state === "NO_SHOW") {
        const error = new Error("Booking đã được đánh dấu NO_SHOW và không thể check-in lại");
        error.statusCode = 400;
        throw error;
      }

      if (booking.status === "IN_USE") {
        const needsManualSync =
          booking.checkin_state !== "MANUAL_CHECKED_IN" ||
          !booking.checked_in_at ||
          booking.checkin_source !== "USER_QR";

        if (needsManualSync) {
          booking.checkin_state = "MANUAL_CHECKED_IN";
          booking.checked_in_at = new Date();
          booking.checkin_source = "USER_QR";
          booking.no_show_marked_at = null;
          await booking.save();
        }
        return booking;
      }

      if (booking.status !== "BOOKED") {
        const error = new Error(`Không thể checkin đặt chỗ với trạng thái ${booking.status}`);
        error.statusCode = 400;
        throw error;
      }

      const updatedBooking = await booking.startUsing();

      // Notify pod device to switch UI from QR screen to keypad screen.
      const actorName =
        (actor && (actor.name || actor.full_name || actor.fullName || actor.email)) ||
        (await User.findOne({ _id: actorId }).select("name email").lean())?.name ||
        "Unknown";

      emitPodCheckinConfirmed({
        pod_id: booking.pod_id,
        booking_id: booking.id,
        customer_name: actorName,
        action: "SWITCH_TO_KEYPAD",
        session_expires_in: 300,
      });

      await BookingAccessSession.create({
        booking_id: booking.id,
        pod_id: booking.pod_id,
        user_id: actorId,
        checkin_at: new Date(),
        checkin_source: "MANUAL",
        access_reason: "BOOKING",
        key_type: "CUSTOMER",
      });

      await notificationService.sendToUser(booking.user_id, {
        title: "Check-in thành công",
        message: "Bạn đã check-in thành công và có thể bắt đầu phiên sử dụng.",
        type: "BOOKING",
        event_code: "BOOKING_CHECKIN",
        dedupe_key: `BOOKING_CHECKIN:${booking.id}`,
        data: {
          type: "BOOKING_CHECKIN",
          booking_id: booking.id,
          order_id: booking.order_id,
          pod_id: booking.pod_id,
          checkin_source: "USER_QR",
        },
      });

      return updatedBooking;
    }

    // ============= CLEANER CHECK-IN (KEY ONLY) =============
    if (!key_token) {
      const error = new Error("QR token là bắt buộc cho customer check-in");
      error.statusCode = 400;
      throw error;
    }

    const onlineKey = await OnlineKey.findOne({
      key_token,
      is_revoked: false,
      key_type: "CLEANER",
    });

    if (!onlineKey) {
      const error = new Error("Cleaner key không hợp lệ hoặc không hoạt động");
      error.statusCode = 404;
      throw error;
    }

    if (String(onlineKey.user_id) !== actorId) {
      const error = new Error("Khóa này không thuộc về người dùng hiện tại.");
      error.statusCode = 403;
      throw error;
    }

    const booking = await Booking.findOne({ id: onlineKey.booking_id });
    if (!booking) {
      const error = new Error("Không tìm thấy đặt chỗ cho khóa này");
      error.statusCode = 404;
      throw error;
    }

    if (booking.checkin_state === "NO_SHOW") {
      const error = new Error("Không được phép vào làm vệ sinh cho booking NO_SHOW");
      error.statusCode = 403;
      throw error;
    }

    if (!booking.cleaner_access_allowed) {
      const error = new Error("Chủ nhân phòng chưa cho phép truy cập làm vệ sinh");
      error.statusCode = 403;
      throw error;
    }

    await this._reconcileCleanerKeyWindow(onlineKey, booking, now);

    if (onlineKey.valid_from > now || onlineKey.valid_to < now) {
      const error = new Error("Cleaner key đã hết hạn hoặc chưa có hiệu lực");
      error.statusCode = 403;
      throw error;
    }

    const cleanerWindowEnd = booking.end_time
      ? new Date(new Date(booking.end_time).getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000)
      : null;

    const isInUseUrgentCleaning = booking.status === "IN_USE";
    const isCompletedCleaningWindow =
      booking.status === "COMPLETED" && cleanerWindowEnd && now <= cleanerWindowEnd;

    if (!isInUseUrgentCleaning && !isCompletedCleaningWindow) {
      const error = new Error(
        `Cleaner chi duoc vao khi booking dang IN_USE (co cho phep) hoac COMPLETED trong ${CLEANER_POST_CHECKOUT_WINDOW_MINUTES} phut sau checkout`
      );
      error.statusCode = 400;
      throw error;
    }

    await BookingAccessSession.create({
      booking_id: booking.id,
      pod_id: booking.pod_id,
      user_id: actorId,
      checkin_at: new Date(),
      checkin_source: "MANUAL",
      access_reason: "CLEANER_ACCESS",
      key_type: "CLEANER",
    });

    return booking;
  }



  /**
   * Cancel booking
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} Updated booking
   */
  async cancelBooking(bookingId) {
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    // Release time slots using BookingSlot relationship
    try {
      // Get all booking slots for this booking
      const bookingSlots = await BookingSlot.find({ booking_id: bookingId });
      const timeSlotIds = bookingSlots.map(bs => bs.time_slot_id);

      // Delete time slots (release them)
      if (timeSlotIds.length > 0) {
        await TimeSlot.deleteMany({ id: { $in: timeSlotIds } });
      }

      // Delete booking slots
      await BookingSlot.deleteMany({ booking_id: bookingId });
    } catch (error) {
      console.error("Error releasing time slots:", error);
    }

    return await booking.cancel();
  }

  /**
   * Delete booking
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} Deleted booking
   */

  /**
   * Check pod availability for time range
   * @param {String} podId - Pod ID
   * @param {Date} startTime - Start time
   * @param {Date} endTime - End time
   * @returns {Promise<Boolean>} True if available
   */
  async checkAvailability(podId, startTime, endTime, actor = null) {
    const pod = await Pod.findOne({ id: podId }).select("id type").lean();
    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    if (!this._isPodTypeAllowedForRole(actor?.role, pod.type)) {
      throw this._buildPodTypeNotAllowedError(actor?.role, pod.type);
    }

    return await Booking.isPodAvailable(podId, startTime, endTime);
  }

  /**
   * Toggle cleaner access confirmation for a booking
   * @param {String} bookingId - Booking ID
   * @param {Object} actor - Authenticated user
   * @param {Boolean} allowed - Cleaner access confirmation flag
   * @returns {Promise<Object>} Updated booking
   */
  async setCleanerAccessFlag(bookingId, actor, allowed) {
    if (typeof allowed !== "boolean") {
      throw new Error("allowed must be boolean");
    }

    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    const actorRole = String(actor?.role || "");
    const actorId = String(actor?._id || actor?.id || "");
    const isOwner = actorId && actorId === String(booking.user_id);
    const canManage = ["admin", "manager"].includes(actorRole);

    if (!isOwner && !canManage) {
      const error = new Error("Not authorized to update cleaner access for this booking");
      error.statusCode = 403;
      throw error;
    }

    if (booking.status === "CANCELLED") {
      const error = new Error("Cannot update cleaner access for cancelled booking");
      error.statusCode = 400;
      throw error;
    }

    if (allowed === true && booking.checkin_state === "NO_SHOW") {
      const error = new Error("Cannot enable cleaner access for NO_SHOW booking");
      error.statusCode = 400;
      throw error;
    }

    booking.cleaner_access_allowed = allowed;
    booking.cleaner_access_updated_at = new Date();
    await booking.save();

    if (String(booking.checkin_state || "").toUpperCase() === "NO_SHOW") {
      await this._revokeCleanerKeysForBooking(booking.id);
    }

    if (allowed) {
      await this._tryAutoAssignCleaningTask(booking, "SET_CLEANER_ACCESS_TRUE");
    }

    return booking;
  }

  /**
   * Manager change pod for booking
   * @param {String} bookingId - Booking ID
   * @param {String} newPodId - New Pod ID
   * @param {Object} actor - Authenticated actor
   * @returns {Promise<Object>} Updated booking
   */
  async managerChangePod(bookingId, newPodId, actor, managerScope = null) {
    if (!newPodId) {
      const error = new Error("pod_id is required");
      error.statusCode = 400;
      throw error;
    }

    if (String(actor?.role || "") !== "manager") {
      const error = new Error("Only manager with accessibility can change booking pod");
      error.statusCode = 403;
      throw error;
    }

    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      const error = new Error("Booking not found");
      error.statusCode = 404;
      throw error;
    }

    const scopedPodIds = new Set((managerScope?.podIds || []).map((podId) => String(podId)));
    if (scopedPodIds.size === 0) {
      const error = new Error("Manager has no assigned pod scope");
      error.statusCode = 403;
      throw error;
    }

    if (!scopedPodIds.has(String(booking.pod_id))) {
      const error = new Error("You are not allowed to manage this booking pod");
      error.statusCode = 403;
      throw error;
    }

    if (!scopedPodIds.has(String(newPodId))) {
      const error = new Error("You are not allowed to move booking to this pod");
      error.statusCode = 403;
      throw error;
    }

    if (!["BOOKED", "IN_USE"].includes(booking.status)) {
      const error = new Error(
        `Cannot change pod for booking with status ${booking.status}`
      );
      error.statusCode = 400;
      throw error;
    }

    if (String(booking.pod_id) === String(newPodId)) {
      const error = new Error("New pod must be different from current pod");
      error.statusCode = 400;
      throw error;
    }

    const [currentPod, nextPod] = await Promise.all([
      Pod.findOne({ id: booking.pod_id }).select("id cluster_id status"),
      Pod.findOne({ id: newPodId }).select("id cluster_id status"),
    ]);

    if (!currentPod) {
      const error = new Error("Current booking pod not found");
      error.statusCode = 404;
      throw error;
    }

    if (!nextPod) {
      const error = new Error("Target pod not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(nextPod.status || "").toUpperCase() !== "AVAILABLE") {
      const error = new Error(
        `Target pod must be AVAILABLE for change pod action (current status: ${nextPod.status || "UNKNOWN"})`
      );
      error.statusCode = 400;
      throw error;
    }

    const [currentCluster, nextCluster] = await Promise.all([
      PodCluster.findOne({ id: currentPod.cluster_id }).select("id location_id"),
      PodCluster.findOne({ id: nextPod.cluster_id }).select("id location_id"),
    ]);

    if (!currentCluster || !nextCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(currentCluster.location_id) !== String(nextCluster.location_id)) {
      const error = new Error("Target pod must be in the same location as current booking pod");
      error.statusCode = 400;
      throw error;
    }

    const isAvailable = await Booking.isPodAvailable(
      nextPod.id,
      booking.start_time,
      booking.end_time,
      booking.id
    );

    if (!isAvailable) {
      const error = new Error("Target pod is not available in booking time range");
      error.statusCode = 409;
      throw error;
    }

    const conflictingTimeSlot = await TimeSlot.findOne({
      pod_id: nextPod.id,
      status: "RESERVED",
      start_time: { $lt: booking.end_time },
      end_time: { $gt: booking.start_time },
    }).select("id");

    if (conflictingTimeSlot) {
      const error = new Error("Target pod has conflicting reserved slots in booking time range");
      error.statusCode = 409;
      throw error;
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

    return booking;
  }
}

module.exports = new BookingService();