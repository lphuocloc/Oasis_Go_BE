const bookingSlotService = require("../services/bookingSlotService");

/**
 * Create a new booking slot
 * @route POST /api/booking-slots
 * @access Private
 */
const createBookingSlot = async (req, res) => {
    try {
        const bookingSlot = await bookingSlotService.createBookingSlot(req.body);
        res.status(201).json({
            success: true,
            message: "Booking slot created successfully",
            data: bookingSlot,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to create booking slot",
        });
    }
};

/**
 * Create multiple booking slots at once
 * @route POST /api/booking-slots/bulk
 * @access Private
 */


/**
 * Get all booking slots with filters
 * @route GET /api/booking-slots
 * @access Private
 */
const getAllBookingSlots = async (req, res) => {
    try {
        const result = await bookingSlotService.getAllBookingSlots(req.query);
        res.status(200).json({
            success: true,
            message: "Booking slots retrieved successfully",
            data: result.bookingSlots,
            pagination: result.pagination,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve booking slots",
        });
    }
};

/**
 * Get booking slot by ID
 * @route GET /api/booking-slots/:id
 * @access Private
 */
const getBookingSlotById = async (req, res) => {
    try {
        const bookingSlot = await bookingSlotService.getBookingSlotById(req.params.id);
        res.status(200).json({
            success: true,
            message: "Booking slot retrieved successfully",
            data: bookingSlot,
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            message: error.message || "Booking slot not found",
        });
    }
};

/**
 * Get booking slots by booking ID
 * @route GET /api/booking-slots/booking/:bookingId
 * @access Private
 */
const getSlotsByBooking = async (req, res) => {
    try {
        const bookingSlots = await bookingSlotService.getSlotsByBooking(
            req.params.bookingId
        );
        res.status(200).json({
            success: true,
            message: "Booking slots retrieved successfully",
            data: bookingSlots,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve booking slots",
        });
    }
};

/**
 * Get bookings by time slot ID
 * @route GET /api/booking-slots/timeslot/:timeSlotId
 * @access Private
 */
const getBookingsByTimeSlot = async (req, res) => {
    try {
        const bookings = await bookingSlotService.getBookingsByTimeSlot(
            req.params.timeSlotId
        );
        res.status(200).json({
            success: true,
            message: "Bookings retrieved successfully",
            data: bookings,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve bookings",
        });
    }
};

/**
 * Check if a time slot is booked
 * @route GET /api/booking-slots/check/:timeSlotId
 * @access Public
 */
const isSlotBooked = async (req, res) => {
    try {
        const isBooked = await bookingSlotService.isSlotBooked(req.params.timeSlotId);
        res.status(200).json({
            success: true,
            message: "Slot status checked successfully",
            data: { isBooked },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to check slot status",
        });
    }
};

/**
 * Delete booking slot
 * @route DELETE /api/booking-slots/:id
 * @access Private
 */
const deleteBookingSlot = async (req, res) => {
    try {
        const result = await bookingSlotService.deleteBookingSlot(req.params.id);
        res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to delete booking slot",
        });
    }
};

/**
 * Delete all booking slots for a booking
 * @route DELETE /api/booking-slots/booking/:bookingId
 * @access Private
 */
const deleteSlotsByBooking = async (req, res) => {
    try {
        const result = await bookingSlotService.deleteSlotsByBooking(
            req.params.bookingId
        );
        res.status(200).json({
            success: true,
            message: result.message,
            deletedCount: result.deletedCount,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to delete booking slots",
        });
    }
};

module.exports = {
    createBookingSlot,
    getAllBookingSlots,
    getBookingSlotById,
    getSlotsByBooking,
    getBookingsByTimeSlot,
    isSlotBooked,
    deleteBookingSlot,
    deleteSlotsByBooking,
};
