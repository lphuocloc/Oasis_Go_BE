const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const OnlineKey = require("../models/OnlineKey");
const PodQrCode = require("../models/PodQrCode");

class BookingService {
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
      .populate("user", "id name email phone")
      .populate("pod", "id name description price_per_hour status")
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
    const bookings = await Booking.getByOrder(orderId);
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
   * Checkin by qr_token and key_token
   * @param {Object} params
   * @returns {Promise<Object>} Updated booking
   */
  async checkinWithQrAndKey({ qr_token, key_token, actor }) {
    if (!qr_token || !key_token) {
      const error = new Error("qr_token and key_token are required");
      error.statusCode = 400;
      throw error;
    }

    const qrCode = await PodQrCode.findOne({ qr_token, is_active: true });
    if (!qrCode) {
      const error = new Error("QR code is invalid or inactive");
      error.statusCode = 404;
      throw error;
    }

    if (new Date(qrCode.expires_at).getTime() < Date.now()) {
      const error = new Error("QR code has expired");
      error.statusCode = 403;
      throw error;
    }

    const onlineKey = await OnlineKey.validateOnlineKey({
      pod_id: qrCode.pod_id,
      key_type: "CUSTOMER",
      key_token,
    });

    const actorId = String(actor?._id || actor?.id || "");
    if (!actorId || String(onlineKey.user_id) !== actorId) {
      const error = new Error("This key does not belong to current user");
      error.statusCode = 403;
      throw error;
    }

    const booking = await Booking.findOne({
      id: onlineKey.booking_id,
      user_id: actorId,
      pod_id: qrCode.pod_id,
    });

    if (!booking) {
      const error = new Error("No valid booking found for this qr_token and key_token");
      error.statusCode = 404;
      throw error;
    }

    if (booking.status === "IN_USE") {
      return booking;
    }

    if (booking.status !== "BOOKED") {
      const error = new Error(`Cannot checkin booking with status ${booking.status}`);
      error.statusCode = 400;
      throw error;
    }

    return await booking.startUsing();
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