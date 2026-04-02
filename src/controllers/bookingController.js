const bookingService = require("../services/bookingService");

/**
 * Create a new booking
 * @route POST /api/bookings
 * @access Private
 */
const createBooking = async (req, res) => {
    try {
        const booking = await bookingService.createBooking(req.body);
        res.status(201).json({
            success: true,
            message: "Booking created successfully",
            data: booking,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to create booking",
        });
    }
};

/**
 * Get all bookings with filters
 * @route GET /api/bookings
 * @access Private (Admin/Manager)
 */
const getAllBookings = async (req, res) => {
    try {
        const result = await bookingService.getAllBookings(req.query);
        res.status(200).json({
            success: true,
            message: "Bookings retrieved successfully",
            data: result.bookings,
            pagination: result.pagination,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve bookings",
        });
    }
};

/**
 * Get booking by ID
 * @route GET /api/bookings/:id
 * @access Private
 */
const getBookingById = async (req, res) => {
    try {
        const booking = await bookingService.getBookingById(req.params.id);
        res.status(200).json({
            success: true,
            message: "Booking retrieved successfully",
            data: booking,
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            message: error.message || "Booking not found",
        });
    }
};

/**
 * Get bookings by user
 * @route GET /api/bookings/user/:userId
 * @access Private
 */
const getBookingsByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { status } = req.query;
        const bookings = await bookingService.getBookingsByUser(userId, status, req.user?.role);
        res.status(200).json({
            success: true,
            message: "User bookings retrieved successfully",
            data: bookings,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve user bookings",
        });
    }
};

/**
 * Get bookings by pod
 * @route GET /api/bookings/pod/:podId
 * @access Private
 */
const getBookingsByPod = async (req, res) => {
    try {
        const { podId } = req.params;
        const { status } = req.query;
        const bookings = await bookingService.getBookingsByPod(podId, status);
        res.status(200).json({
            success: true,
            message: "Pod bookings retrieved successfully",
            data: bookings,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve pod bookings",
        });
    }
};

/**
 * Get bookings by order
 * @route GET /api/bookings/order/:orderId
 * @access Private
 */
const getBookingsByOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const bookings = await bookingService.getBookingsByOrder(orderId, req.user?.role);
        res.status(200).json({
            success: true,
            message: "Order bookings retrieved successfully",
            data: bookings,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to retrieve order bookings",
        });
    }
};

/**
 * Update booking
 * @route PUT /api/bookings/:id
 * @access Private
 */
const updateBooking = async (req, res) => {
    try {
        const booking = await bookingService.updateBooking(
            req.params.id,
            req.body
        );
        res.status(200).json({
            success: true,
            message: "Booking updated successfully",
            data: booking,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to update booking",
        });
    }
};


/**
 * Checkin booking
 * - Customer: qr_token only
 * - Cleaner: key_token only
 * @route POST /api/bookings/checkin
 * @access Private
 */
const checkinWithQrAndKey = async (req, res) => {
    try {
        const { qr_token, key_token } = req.body;
        const booking = await bookingService.checkinWithQrAndKey({
            qr_token,
            key_token,
            actor: req.user,
        });

        res.status(200).json({
            success: true,
            message: "Checkin successful",
            data: booking,
        });
    } catch (error) {
        const statusCode = error.statusCode || 400;
        const response = {
            success: false,
            message: error.message || "Failed to checkin",
        };

        res.status(statusCode).json(response);
    }
};

/**
 * Get my cleaner online key by booking ID
 * @route GET /api/bookings/:id/my-cleaner-key
 * @access Private (Cleaner)
 */
const getMyCleanerKeyByBookingId = async (req, res) => {
    try {
        const result = await bookingService.getMyCleanerKeyByBookingId(
            req.params.id,
            req.user
        );

        res.status(200).json({
            success: true,
            message: "Cleaner key retrieved successfully",
            data: result,
        });
    } catch (error) {
        const statusCode = error.statusCode || 400;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Failed to retrieve cleaner key",
        });
    }
};



/**
 * Cancel booking
 * @route POST /api/bookings/:id/cancel
 * @access Private
 */
const cancelBooking = async (req, res) => {
    try {
        const booking = await bookingService.cancelBooking(req.params.id);
        res.status(200).json({
            success: true,
            message: "Booking cancelled successfully",
            data: booking,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || "Failed to cancel booking",
        });
    }
};


/**
 * Check pod availability
 * @route GET /api/bookings/check-availability/:podId
 * @access Public
 */
const checkAvailability = async (req, res) => {
    try {
        const { podId } = req.params;
        const { start_time, end_time } = req.query;

        if (!start_time || !end_time) {
            return res.status(400).json({
                success: false,
                message: "start_time and end_time are required",
            });
        }

        const isAvailable = await bookingService.checkAvailability(
            podId,
            start_time,
            end_time
        );

        res.status(200).json({
            success: true,
            message: "Availability checked successfully",
            data: { available: isAvailable },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Failed to check availability",
        });
    }
};

/**
 * Set cleaner access confirmation flag for booking
 * @route POST /api/bookings/:id/cleaner-access
 * @access Private
 */
const setCleanerAccessFlag = async (req, res) => {
    try {
        const { allowed } = req.body;
        const booking = await bookingService.setCleanerAccessFlag(
            req.params.id,
            req.user,
            allowed
        );

        res.status(200).json({
            success: true,
            message: `Cleaner access ${allowed ? "enabled" : "disabled"} successfully`,
            data: booking,
        });
    } catch (error) {
        const statusCode = error.statusCode || 400;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Failed to update cleaner access",
        });
    }
};

/**
 * Admin change pod for booking
 * @route PATCH /api/bookings/:id/change-pod
 * @access Private (Manager)
 */
const managerChangePod = async (req, res) => {
    try {
        const { pod_id } = req.body;
        const booking = await bookingService.managerChangePod(
            req.params.id,
            pod_id,
            req.user,
            req.managerScope
        );

        res.status(200).json({
            success: true,
            message: "Booking pod changed successfully",
            data: booking,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to change booking pod",
        });
    }
};

module.exports = {
    createBooking,
    getAllBookings,
    getBookingById,
    getBookingsByUser,
    getBookingsByPod,
    getBookingsByOrder,
    updateBooking,
    checkinWithQrAndKey,
    getMyCleanerKeyByBookingId,
    cancelBooking,
    checkAvailability,
    setCleanerAccessFlag,
    managerChangePod,
};
