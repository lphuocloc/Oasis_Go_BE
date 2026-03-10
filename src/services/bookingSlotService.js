const BookingSlot = require("../models/BookingSlot");
const Booking = require("../models/Bookings");
const TimeSlot = require("../models/TimeSlot");

class BookingSlotService {
    /**
     * Create a new booking slot
     * @param {Object} data - Booking slot data
     * @returns {Promise<Object>} Created booking slot
     */
    async createBookingSlot(data) {
        const { booking_id, time_slot_id } = data;

        // Validate booking exists
        const booking = await Booking.findOne({ id: booking_id });
        if (!booking) {
            throw new Error("Booking not found");
        }

        // Validate time slot exists
        const timeSlot = await TimeSlot.findOne({ id: time_slot_id });
        if (!timeSlot) {
            throw new Error("Time slot not found");
        }

        // Check if slot is already booked
        const existingSlot = await BookingSlot.findOne({
            booking_id,
            time_slot_id,
        });
        if (existingSlot) {
            throw new Error("This time slot is already linked to this booking");
        }

        // Check if time slot is available
        if (timeSlot.status !== "AVAILABLE" && timeSlot.status !== "RESERVED") {
            throw new Error("Time slot is not available");
        }

        // Create booking slot
        const bookingSlot = await BookingSlot.create({
            booking_id,
            time_slot_id,
        });

        // Update time slot status to RESERVED
        timeSlot.status = "RESERVED";
        await timeSlot.save();

        return bookingSlot;
    }


    /**
     * Get all booking slots with filters
     * @param {Object} filters - Filter options
     * @returns {Promise<Object>} List of booking slots with pagination
     */
    async getAllBookingSlots(filters = {}) {
        const { booking_id, time_slot_id, page = 1, limit = 20 } = filters;

        const query = {};
        if (booking_id) query.booking_id = booking_id;
        if (time_slot_id) query.time_slot_id = time_slot_id;

        const skip = (page - 1) * limit;

        const [bookingSlots, total] = await Promise.all([
            BookingSlot.find(query)
                .populate("booking", "id order_id user_id pod_id status")
                .populate("timeSlot", "id pod_id start_time end_time status")
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            BookingSlot.countDocuments(query),
        ]);

        return {
            bookingSlots,
            pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(total / limit),
                total_items: total,
                items_per_page: parseInt(limit),
            },
        };
    }

    /**
     * Get booking slot by ID
     * @param {String} id - Booking slot ID
     * @returns {Promise<Object>} Booking slot details
     */
    async getBookingSlotById(id) {
        const bookingSlot = await BookingSlot.findOne({ id })
            .populate("booking", "id order_id user_id pod_id start_time end_time status")
            .populate("timeSlot", "id pod_id start_time end_time status");

        if (!bookingSlot) {
            throw new Error("Booking slot not found");
        }

        return bookingSlot;
    }

    /**
     * Get booking slots by booking ID
     * @param {String} bookingId - Booking ID
     * @returns {Promise<Array>} Booking slots for this booking
     */
    async getSlotsByBooking(bookingId) {
        return await BookingSlot.getByBooking(bookingId);
    }

    /**
     * Get bookings by time slot ID
     * @param {String} timeSlotId - Time slot ID
     * @returns {Promise<Array>} Bookings using this time slot
     */
    async getBookingsByTimeSlot(timeSlotId) {
        return await BookingSlot.getByTimeSlot(timeSlotId);
    }

    /**
     * Delete booking slot
     * @param {String} id - Booking slot ID
     * @returns {Promise<Object>} Result
     */
    async deleteBookingSlot(id) {
        const bookingSlot = await BookingSlot.findOne({ id });
        if (!bookingSlot) {
            throw new Error("Booking slot not found");
        }

        // Release the time slot
        await TimeSlot.updateOne(
            { id: bookingSlot.time_slot_id },
            { $set: { status: "AVAILABLE" } }
        );

        await BookingSlot.deleteOne({ id });

        return { message: "Booking slot deleted successfully" };
    }

    /**
     * Delete all booking slots for a booking
     * @param {String} bookingId - Booking ID
     * @returns {Promise<Object>} Result
     */
    async deleteSlotsByBooking(bookingId) {
        const bookingSlots = await BookingSlot.find({ booking_id: bookingId });

        if (bookingSlots.length === 0) {
            return { message: "No booking slots found for this booking", deletedCount: 0 };
        }

        // Get all time slot IDs
        const timeSlotIds = bookingSlots.map((slot) => slot.time_slot_id);

        // Release all time slots
        await TimeSlot.updateMany(
            { id: { $in: timeSlotIds } },
            { $set: { status: "AVAILABLE" } }
        );

        // Delete all booking slots
        const result = await BookingSlot.deleteByBooking(bookingId);

        return {
            message: "Booking slots deleted successfully",
            deletedCount: result.deletedCount,
        };
    }

    /**
     * Check if a time slot is already booked
     * @param {String} timeSlotId - Time slot ID
     * @returns {Promise<Boolean>} True if booked
     */
    async isSlotBooked(timeSlotId) {
        return await BookingSlot.isSlotBooked(timeSlotId);
    }
}

module.exports = new BookingSlotService();
