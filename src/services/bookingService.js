const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");

class BookingService {
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
    const user = await User.findOne({ id: user_id });
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
   * Get all bookings with filters
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} List of bookings with pagination
   */
  async getAllBookings(filters = {}) {
    const {
      user_id,
      pod_id,
      order_id,
      status,
      start_date,
      end_date,
      page = 1,
      limit = 20,
    } = filters;

    const query = {};

    if (user_id) query.user_id = user_id;
    if (pod_id) query.pod_id = pod_id;
    if (order_id) query.order_id = order_id;
    if (status) query.status = status;

    if (start_date || end_date) {
      query.start_time = {};
      if (start_date) query.start_time.$gte = new Date(start_date);
      if (end_date) query.start_time.$lte = new Date(end_date);
    }

    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "id name email phone")
        .populate("pod", "id name description status")
        .populate("order", "id final_total_price status"),
      Booking.countDocuments(query),
    ]);

    return {
      bookings,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_items: total,
        items_per_page: parseInt(limit),
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
  async getBookingsByUser(userId, status = null) {
    return await Booking.getByUser(userId, status);
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
  async getBookingsByOrder(orderId) {
    return await Booking.getByOrder(orderId);
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
  async startUsing(bookingId) {
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    return await booking.startUsing();
  }

  /**
   * Complete booking
   * @param {String} bookingId - Booking ID
   * @param {Date} actualEndTime - Actual end time
   * @returns {Promise<Object>} Updated booking
   */
  async completeBooking(bookingId, actualEndTime = null) {
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    return await booking.complete(actualEndTime);
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

    // Release time slots if they were reserved
    try {
      await TimeSlot.updateMany(
        {
          pod_id: booking.pod_id,
          start_time: { $gte: booking.start_time },
          end_time: { $lte: booking.end_time },
          status: "RESERVED",
        },
        { status: "AVAILABLE" }
      );
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
  async deleteBooking(bookingId) {
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      throw new Error("Booking not found");
    }

    // Only allow deletion of cancelled bookings
    if (booking.status !== "CANCELLED") {
      throw new Error("Can only delete cancelled bookings");
    }

    await Booking.deleteOne({ id: bookingId });
    return booking;
  }

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
}

module.exports = new BookingService();