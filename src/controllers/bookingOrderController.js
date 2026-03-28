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

            const result = await bookingOrderService.getBookingOrderById(id, {
                actor: req.user,
                managerScope: req.managerScope,
            });

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
                pod_ids: req.query.pod_ids,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 20
            };

            const result = await bookingOrderService.getAllBookingOrders(filters, {
                actor: req.user,
                managerScope: req.managerScope,
            });

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
            const { booking_id, booking_ids } = req.body || {};

            const order = await bookingOrderService.cancelBookingOrder(id, req.user, {
                booking_ids: [
                    ...(Array.isArray(booking_ids) ? booking_ids : []),
                    ...(booking_id ? [booking_id] : []),
                ],
            });

            return res.status(200).json({
                success: true,
                message: "Booking order cancellation processed successfully",
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

    /**
     * Checkout booking order (all or selected bookings)
     * @route POST /api/booking-orders/:id/checkout
     */
    async checkoutBookingOrder(req, res) {
        try {
            const { id } = req.params;
            const { scope, booking_id, booking_ids } = req.body || {};

            const result = await bookingOrderService.checkoutOrder(id, req.user, {
                scope,
                booking_id,
                booking_ids,
            });

            return res.status(200).json({
                success: true,
                message: "Booking order checkout processed",
                data: result,
            });
        } catch (error) {
            console.error("Error checkout booking order:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to checkout booking order",
            });
        }
    }

    /**
     * Initiate repayment for PENDING order
     * @route POST /api/booking-orders/:id/repay
     */
    async initiateRepayment(req, res) {
        try {
            const { id } = req.params;
            const paymentService = require("../services/paymentService");
            const ipAddr = req.ip || req.connection.remoteAddress;

            const result = await paymentService.initiateRepayment(id, req.user, ipAddr);

            return res.status(201).json({
                success: true,
                message: result.message,
                data: result
            });
        } catch (error) {
            console.error("Error initiating repayment:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to initiate repayment"
            });
        }
    }

    /**
     * Get pending refund requests that manager can process
     * @route GET /api/booking-orders/refunds/pending
     */
    async getPendingRefundRequests(req, res) {
        try {
            const filters = {
                pod_ids: req.query.pod_ids,
                order_id: req.query.order_id,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 20,
            };

            const result = await bookingOrderService.getPendingRefundRequests(filters, {
                actor: req.user,
                managerScope: req.managerScope,
            });

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            console.error("Error getting pending refund requests:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to get pending refund requests",
            });
        }
    }

    /**
     * Process a pending refund request (approve/reject)
     * @route POST /api/booking-orders/refunds/:refundId/process
     */
    async processRefundRequest(req, res) {
        try {
            const { refundId } = req.params;
            const { action, note } = req.body || {};

            const result = await bookingOrderService.processRefundRequest(refundId, req.user, {
                action,
                note,
                managerScope: req.managerScope,
            });

            return res.status(200).json({
                success: true,
                message: "Refund request processed successfully",
                data: result,
            });
        } catch (error) {
            console.error("Error processing refund request:", error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || "Failed to process refund request",
            });
        }
    }
}

module.exports = new BookingOrderController();
