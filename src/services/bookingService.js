const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const BookingAccessSession = require("../models/BookingAccessSession");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const OnlineKey = require("../models/OnlineKey");
const PodQrCode = require("../models/PodQrCode");
const notificationService = require("./notificationService");

const AUTO_ACTIVATE_GRACE_PERIOD_MINUTES = 15;
const POD_DETAILS_SELECT =
  "id cluster_id code name description status maintenance_status " +
  "soundproof_level ventilation_level power_outlets wifi_available " +
  "max_session_duration last_cleaned_at createdAt updatedAt";

class BookingService {
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
        body: "Bạn chưa check-in đúng giờ, hệ thống đã tự động kích hoạt phiên sử dụng của bạn.",
        data: {
          type: "BOOKING_AUTO_ACTIVATED",
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

      await notificationService.sendToUser(booking.user_id, {
        title: "Phiên sử dụng kết thúc do không check-in",
        body: "Phiên sử dụng của bạn đã hết giờ và được ghi nhận là NO_SHOW.",
        data: {
          type: "BOOKING_NO_SHOW",
          booking_id: booking.id,
          order_id: booking.order_id,
          pod_id: booking.pod_id,
        },
      });
    }

    return {
      found: expiredAutoActivatedBookings.length,
      no_show_marked: markedCount,
    };
  }

  async autoCheckoutExpiredBookings() {
    const now = new Date();

    // Find bookings that are still IN_USE but past their end_time
    const expiredBookings = await Booking.find({
      status: "IN_USE",
      end_time: { $lte: now },
    }).select("id user_id pod_id order_id start_time end_time status");

    if (expiredBookings.length === 0) {
      return { found: 0, auto_checked_out: 0, access_logs_updated: 0 };
    }

    let autoCheckedOutCount = 0;
    let accessLogsUpdatedCount = 0;

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
    }

    return {
      found: expiredBookings.length,
      auto_checked_out: autoCheckedOutCount,
      access_logs_updated: accessLogsUpdatedCount,
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
    ]).catch((error) => {
      console.error("Initial auto-activate checkin job failed:", error);
    });

    setInterval(async () => {
      try {
        await Promise.all([
          this.autoActivateOverdueCheckins(graceMinutes),
          this.markNoShowForExpiredAutoActivatedBookings(),
          this.autoCheckoutExpiredBookings(),
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
  async createBooking(bookingData) {
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
    if (status) query.status = status;

    if (start_date || end_date) {
      query.start_time = {};
      if (start_date) query.start_time.$gte = new Date(start_date);
      if (end_date) query.start_time.$lte = new Date(end_date);
    }

    // If no pagination params, return all results
    if (!page && !limit) {
      const bookings = await Booking.find(query)
        .sort({ created_at: -1 })
        .populate("user", "id name email phone")
        .populate("pod", "id name description status")
        .populate("order", "id final_total_price status");
      return { bookings };
    }

    // With pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("user", "id name email phone")
        .populate("pod", "id name description status")
        .populate("order", "id final_total_price status"),
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
  async getBookingById(bookingId) {
    const booking = await Booking.findOne({ id: bookingId })
      .select(
        "id order_id user_id pod_id start_time end_time actual_end_time status " +
        "cleaner_access_allowed cleaner_access_updated_at checkin_state checked_in_at checkin_source auto_activated_at no_show_marked_at " +
        "base_price total_price createdAt updatedAt"
      )
      .populate("pod", POD_DETAILS_SELECT)
      .populate("order", "id final_total_price status payment_method");

    if (!booking) {
      throw new Error("Booking not found");
    }

    return booking;
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
    return booking;
  }

  /**
   * Start using pod (change status from BOOKED to IN_USE)
   * @param {String} bookingId - Booking ID
   * @returns {Promise<Object>} Updated booking
   */


  /**
   * Checkin by qr_token and key_token (or key_token only for cleaners)
   * - CUSTOMER: Requires both QR token and online key token
   * - CLEANER: Only requires online key token (no QR needed)
   * @param {Object} params
   * @returns {Promise<Object>} Updated booking or booking info
   */
  async checkinWithQrAndKey({ qr_token, key_token, actor }) {
    if (!key_token) {
      const error = new Error("Key token là bắt buộc");
      error.statusCode = 400;
      throw error;
    }

    const actorId = String(actor?._id || actor?.id || "");

    // Find online key by key_token first (works for both CUSTOMER and CLEANER)
    const onlineKey = await OnlineKey.findOne({
      key_token,
      is_revoked: false,
    });

    if (!onlineKey) {
      const error = new Error("Khóa không hợp lệ hoặc không hoạt động");
      error.statusCode = 404;
      throw error;
    }

    // Validate key is in valid time window
    const now = new Date();
    if (onlineKey.valid_from > now || onlineKey.valid_to < now) {
      const error = new Error("Khóa đã hết hạn hoặc chưa có hiệu lực");
      error.statusCode = 403;
      throw error;
    }

    // Validate key is not locked due to failed attempts
    if (onlineKey.isLocked(now)) {
      const error = new Error("Khóa bị khóa do nhiều lần nhập sai. Vui lòng chờ một lúc");
      error.statusCode = 429;
      error.cooldown_until = onlineKey.locked_until;
      throw error;
    }

    // Actor must be the key owner
    if (!actorId || String(onlineKey.user_id) !== actorId) {
      const error = new Error("Khóa này không thuộc về người dùng hiện tại.");
      error.statusCode = 403;
      throw error;
    }

    // Reset failed attempts on successful validation
    if (onlineKey.failed_attempts > 0 || onlineKey.locked_until || onlineKey.last_failed_at) {
      await onlineKey.resetAttemptState();
    }

    const booking = await Booking.findOne({
      id: onlineKey.booking_id,
    });

    if (!booking) {
      const error = new Error("Không tìm thấy đặt chỗ cho khóa này");
      error.statusCode = 404;
      throw error;
    }

    // Determine access type based on key_type
    const isCleanerAccess = onlineKey.key_type === "CLEANER";
    const isCustomerAccess = onlineKey.key_type === "CUSTOMER";

    // ============= CUSTOMER CHECK-IN =============
    if (isCustomerAccess) {
      // CUSTOMER requires QR code validation
      if (!qr_token) {
        const error = new Error("QR token là bắt buộc cho khách hàng");
        error.statusCode = 400;
        throw error;
      }

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

      // Validate QR pod matches booking pod
      if (String(qrCode.pod_id) !== String(booking.pod_id)) {
        const error = new Error("QR code không khớp với pod của booking");
        error.statusCode = 403;
        throw error;
      }

      // Validate booking belongs to customer
      if (String(booking.user_id) !== actorId) {
        const error = new Error("Booking này không thuộc về người dùng hiện tại.");
        error.statusCode = 403;
        throw error;
      }

      if (booking.status === "IN_USE") {
        if (booking.checkin_state === "NO_SHOW") {
          const error = new Error("Booking đã được đánh dấu NO_SHOW và không thể check-in lại");
          error.statusCode = 400;
          throw error;
        }

        const needsManualSync =
          booking.checkin_state !== "MANUAL_CHECKED_IN" ||
          !booking.checked_in_at ||
          booking.checkin_source !== "USER_QR";

        if (needsManualSync) {
          booking.checkin_state = "MANUAL_CHECKED_IN";
          booking.checked_in_at = booking.checked_in_at || new Date();
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

      // Start using and log access
      const updatedBooking = await booking.startUsing();

      // Create booking access session for customer manual check-in
      await BookingAccessSession.create({
        booking_id: booking.id,
        pod_id: booking.pod_id,
        user_id: actorId,
        checkin_at: new Date(),
        checkin_source: "MANUAL",
        access_reason: "BOOKING",
        key_type: "CUSTOMER",
      });

      return updatedBooking;
    }

    // ============= CLEANER CHECK-IN =============
    if (isCleanerAccess) {
      // CLEANER doesn't need QR code, only online key

      // Validate cleaner access requirements
      if (booking.checkin_state === "NO_SHOW") {
        const error = new Error("Không được phép vào làm vệ sinh cho booking NO_SHOW");
        error.statusCode = 403;
        throw error;
      }

      if (booking.status !== "COMPLETED") {
        const error = new Error("Chỉ có thể vào làm vệ sinh sau khi khách hàng checkout (booking COMPLETED)");
        error.statusCode = 400;
        throw error;
      }

      if (!booking.cleaner_access_allowed) {
        const error = new Error("Chủ nhân phòng chưa cho phép truy cập làm vệ sinh");
        error.statusCode = 403;
        throw error;
      }

      // Create booking access session for cleaner manual check-in (NO QR code needed)
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

    // Should not reach here if key_type is recognized
    const error = new Error("Loại khóa không hợp lệ");
    error.statusCode = 400;
    throw error;
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
  async checkAvailability(podId, startTime, endTime) {
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

    booking.cleaner_access_allowed = allowed;
    booking.cleaner_access_updated_at = new Date();
    await booking.save();

    return booking;
  }
}

module.exports = new BookingService();