const bookingOrderService = require("../services/bookingOrderService");

class BookingOrderController {
    /**
     * Create a new booking order
     * @route POST /api/booking-orders
     */
    async createBookingOrder(req, res) {
        try {
            // Get user_id from authenticated user (middleware)
            const user_id = req.user._id;
            const {
                cluster_id,
                start_time,
                end_time,
                pod_count,
                total_discount,
                require_adjacent,
                floor_preference,
                accept_fragmented,
                accept_mixed_floor
            } = req.body;

            // Validate required fields
            if (!cluster_id || !start_time || !end_time) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields: cluster_id, start_time, end_time"
                });
            }

            const result = await bookingOrderService.createBookingOrder({
                user_id,
                cluster_id,
                start_time,
                end_time,
                pod_count: pod_count || 1,
                total_discount: total_discount || 0,
                require_adjacent: require_adjacent || false,
                floor_preference: floor_preference || null,
                accept_fragmented: accept_fragmented || false,
                accept_mixed_floor: accept_mixed_floor || false
            });

            return res.status(201).json({
                success: true,
                message: "Booking order created successfully",
                data: result
            });
        } catch (error) {
            console.error("Error creating booking order:", error);
            const responsePayload = {
                success: false,
                message: error.message || "Failed to create booking order"
            };
            if (error.code) responsePayload.code = error.code;
            if (error.data) responsePayload.data = error.data;

            return res.status(error.statusCode || 500).json(responsePayload);
        }
    }

    /**
     * Get booking order by ID
     * @route GET /api/booking-orders/:id
     */
    async getBookingOrderById(req, res) {
        try {
            const { id } = req.params;

            const result = await bookingOrderService.getBookingOrderById(id);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error("Error getting booking order:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to get booking order"
            });
        }
    }

    /**
     * Get all booking orders with filters
     * @route GET /api/booking-orders
     */
    async getAllBookingOrders(req, res) {
        try {
            const filters = {
                user_id: req.query.user_id,
                status: req.query.status,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 20
            };

            const result = await bookingOrderService.getAllBookingOrders(filters);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error("Error getting booking orders:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to get booking orders"
            });
        }
    }

    /**
     * Cancel booking order
     * @route PUT /api/booking-orders/:id/cancel
     */
    async cancelBookingOrder(req, res) {
        try {
            const { id } = req.params;

            const order = await bookingOrderService.cancelBookingOrder(id);

            return res.status(200).json({
                success: true,
                message: "Booking order cancelled successfully",
                data: order
            });
        } catch (error) {
            console.error("Error cancelling booking order:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to cancel booking order"
            });
        }
    }
}

module.exports = new BookingOrderController();
