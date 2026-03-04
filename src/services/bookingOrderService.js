const BookingOrder = require("../models/BookingOrder");
const Booking = require("../models/Bookings");
const PodCluster = require("../models/PodCluster");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const mongoose = require("mongoose");
const timeSlotService = require("./timeSlotService");

// Slot configuration
const SLOT_DURATION_MINUTES = 30;
const HOLD_EXPIRATION_MINUTES = 3;


class BookingOrderService {
    /**
     * Create a new booking order with multiple pod bookings
     * Uses Mongoose Transaction to ensure data consistency
     * @param {Object} orderData - Order data
     * @returns {Promise<Object>} Created order with bookings
     */
    async createBookingOrder(orderData) {
        const {
            user_id,
            cluster_id,
            start_time,
            end_time,
            total_discount = 0,
            pod_count = 1,
        } = orderData;

        // Start a session for transaction
        const session = await mongoose.startSession();

        try {
            // Start transaction
            return await session.withTransaction(async () => {
                // Validate required fields
                if (!user_id || !cluster_id || !start_time || !end_time) {
                    const error = new Error("Missing required fields: user_id, cluster_id, start_time, end_time");
                    error.statusCode = 400;
                    throw error;
                }

                // Validate user exists
                const user = await User.findOne({ _id: user_id });
                if (!user) {
                    const error = new Error("User not found");
                    error.statusCode = 404;
                    throw error;
                }

                // Validate cluster exists
                const cluster = await PodCluster.findOne({ id: cluster_id });
                if (!cluster) {
                    const error = new Error("Pod cluster not found");
                    error.statusCode = 404;
                    throw error;
                }

                // Validate time range
                const startDate = new Date(start_time);
                const endDate = new Date(end_time);

                if (endDate <= startDate) {
                    const error = new Error("End time must be after start time");
                    error.statusCode = 400;
                    throw error;
                }

                // Check if start time is in the future
                const now = new Date();
                if (startDate < now) {
                    const error = new Error("Start time must be in the future");
                    error.statusCode = 400;
                    throw error;
                }

                // Get all pods in cluster
                const allPods = await Pod.find({
                    cluster_id,
                    status: { $nin: ['MAINTENANCE'] }
                }).lean();

                if (allPods.length === 0) {
                    const error = new Error("No available pods in this cluster");
                    error.statusCode = 404;
                    throw error;
                }

                // Find available pods for the time range
                const availablePods = await this._findAvailablePods(
                    allPods,
                    startDate,
                    endDate
                );

                if (availablePods.length < pod_count) {
                    const error = new Error(
                        `Only ${availablePods.length} pod(s) available. You requested ${pod_count} pod(s)`
                    );
                    error.statusCode = 409;
                    throw error;
                }

                // Select pods to book
                const podsToBook = availablePods.slice(0, pod_count);

                // Calculate duration in minutes
                const durationMs = endDate - startDate;
                const durationMinutes = Math.ceil(durationMs / (1000 * 60));
                const durationHours = durationMinutes / 60;

                // Calculate pricing
                // base_price_modifier is the price per 30-minute slot
                const SLOT_DURATION_MINUTES = 30;
                const pricePerSlot = cluster.base_price_modifier || 0;
                const numberOfSlots = Math.ceil(durationMinutes / SLOT_DURATION_MINUTES);

                const pricePerPod = pricePerSlot * numberOfSlots;
                const totalBasePrice = pricePerPod * pod_count;

                // Apply discount
                const discountAmount = total_discount || 0;
                const finalTotalPrice = Math.max(0, totalBasePrice - discountAmount);

                // Create booking order within transaction
                const bookingOrderArray = await BookingOrder.create([{
                    user_id,
                    total_base_price: totalBasePrice,
                    total_discount: discountAmount,
                    final_total_price: finalTotalPrice,
                    status: 'PENDING'
                }], { session });

                const bookingOrder = bookingOrderArray[0];

                // Create individual bookings for each pod within transaction
                const bookings = [];
                const bookingDocs = [];

                for (const pod of podsToBook) {
                    bookingDocs.push({
                        order_id: bookingOrder.id,
                        user_id,
                        pod_id: pod.id,
                        start_time: startDate,
                        end_time: endDate,
                        base_price: pricePerPod,
                        total_price: pricePerPod,
                        status: 'BOOKED'
                    });
                }

                // Batch create all bookings within transaction
                const createdBookings = await Booking.create(bookingDocs, { session, ordered: true });
                bookings.push(...createdBookings);

                // Generate time slots and booking slots for each booking
                const allTimeSlotIds = [];
                for (const booking of createdBookings) {
                    // Generate 30-minute time slots for this booking's time range
                    const timeSlotDocs = this._generateTimeSlots(
                        booking.pod_id,
                        new Date(booking.start_time),
                        new Date(booking.end_time)
                    );

                    // Create time slots within transaction
                    const createdTimeSlots = await TimeSlot.create(timeSlotDocs, { session, ordered: true });

                    // Create booking slots linking booking to time slots
                    const bookingSlotDocs = createdTimeSlots.map(ts => ({
                        booking_id: booking.id,
                        time_slot_id: ts.id
                    }));

                    await BookingSlot.create(bookingSlotDocs, { session, ordered: true });

                    // Collect time slot IDs for response
                    allTimeSlotIds.push(...createdTimeSlots.map(ts => ts.id));
                }

                // Schedule expiration check for PENDING order (3 minutes)
                this._scheduleOrderExpiration(bookingOrder.id, HOLD_EXPIRATION_MINUTES);

                // Return order with bookings
                return {
                    order: {
                        id: bookingOrder.id,
                        user_id: bookingOrder.user_id,
                        total_base_price: bookingOrder.total_base_price,
                        total_discount: bookingOrder.total_discount,
                        final_total_price: bookingOrder.final_total_price,
                        status: bookingOrder.status,
                        created_at: bookingOrder.createdAt,
                    },
                    bookings: bookings.map(b => ({
                        id: b.id,
                        pod_id: b.pod_id,
                        start_time: b.start_time,
                        end_time: b.end_time,
                        base_price: b.base_price,
                        total_price: b.total_price,
                        status: b.status,
                    })),
                    summary: {
                        cluster_id,
                        start_time: startDate,
                        end_time: endDate,
                        duration_minutes: durationMinutes,
                        duration_hours: durationHours,
                        number_of_slots: numberOfSlots,
                        pods_booked: pod_count,
                        price_per_slot: pricePerSlot,
                        price_per_pod: pricePerPod,
                        total_base_price: totalBasePrice,
                        total_discount: discountAmount,
                        final_total_price: finalTotalPrice
                    }
                };
            }); // End of withTransaction
        } catch (error) {
            throw error;
        } finally {
            // End session
            session.endSession();
        }
    }

    /**
     * Find available pods for given time range
     * @private
     * @param {Array} pods - List of pods to check
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @returns {Promise<Array>} Available pods
     */
    async _findAvailablePods(pods, startTime, endTime) {
        const availablePods = [];

        for (const pod of pods) {
            // Check if pod has any conflicting bookings
            const conflictingBooking = await Booking.findOne({
                pod_id: pod.id,
                status: { $in: ['BOOKED', 'IN_USE'] },
                $or: [
                    {
                        start_time: { $lt: endTime },
                        end_time: { $gt: startTime }
                    }
                ]
            });

            if (conflictingBooking) {
                continue; // Skip this pod
            }

            // Check if pod has any reserved time slots in the requested range
            const conflictingTimeSlot = await TimeSlot.findOne({
                pod_id: pod.id,
                status: 'RESERVED',
                $or: [
                    {
                        start_time: { $lt: endTime },
                        end_time: { $gt: startTime }
                    }
                ]
            });

            if (!conflictingTimeSlot) {
                availablePods.push(pod);
            }
        }

        return availablePods;
    }

    /**
     * Generate time slot documents for a booking time range
     * @private
     * @param {String} podId - Pod ID
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @returns {Array} Array of time slot documents
     */
    _generateTimeSlots(podId, startTime, endTime) {
        const slots = [];
        let currentStart = new Date(startTime);

        while (currentStart < endTime) {
            const currentEnd = new Date(currentStart);
            currentEnd.setMinutes(currentEnd.getMinutes() + SLOT_DURATION_MINUTES);

            // Don't exceed the booking end time
            const slotEnd = currentEnd > endTime ? endTime : currentEnd;

            slots.push({
                pod_id: podId,
                start_time: new Date(currentStart),
                end_time: slotEnd,
                status: 'RESERVED'
            });

            currentStart = new Date(currentEnd);
        }

        return slots;
    }

    /**
     * Schedule order expiration check
     * If order is not paid within the specified minutes, release the slots
     * @private
     * @param {String} orderId - Order ID
     * @param {Number} minutes - Minutes until expiration
     */
    _scheduleOrderExpiration(orderId, minutes) {
        setTimeout(async () => {
            try {
                const order = await BookingOrder.findOne({ id: orderId });

                // Only cancel if still PENDING
                if (order && order.status === 'PENDING') {
                    console.log(`Order ${orderId} expired. Releasing held slots...`);

                    // Get all bookings for this order
                    const bookings = await Booking.find({ order_id: orderId });

                    for (const booking of bookings) {
                        // Get all booking slots
                        const bookingSlots = await BookingSlot.find({ booking_id: booking.id });
                        const timeSlotIds = bookingSlots.map(bs => bs.time_slot_id);

                        // Delete time slots (release them)
                        if (timeSlotIds.length > 0) {
                            await TimeSlot.deleteMany({ id: { $in: timeSlotIds } });
                        }

                        // Delete booking slots
                        await BookingSlot.deleteMany({ booking_id: booking.id });
                    }

                    // Update booking statuses to CANCELLED
                    await Booking.updateMany(
                        { order_id: orderId },
                        { $set: { status: 'CANCELLED' } }
                    );

                    // Update order status to CANCELLED
                    order.status = 'CANCELLED';
                    await order.save();

                    console.log(`Order ${orderId} cancelled and slots released.`);
                }
            } catch (error) {
                console.error(`Error expiring order ${orderId}:`, error);
            }
        }, minutes * 60 * 1000);
    }

    /**
     * Get booking order by ID
     * @param {String} orderId - Order ID
     * @returns {Promise<Object>} Order with bookings
     */
    async getBookingOrderById(orderId) {
        try {
            const order = await BookingOrder.findOne({ id: orderId }).lean();

            if (!order) {
                const error = new Error("Booking order not found");
                error.statusCode = 404;
                throw error;
            }

            // Get all bookings for this order
            const bookings = await Booking.find({ order_id: orderId })
                .populate('pod_id')
                .lean();

            return {
                order,
                bookings
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get all booking orders with filters
     * @param {Object} filters - Query filters
     * @returns {Promise<Object>} Orders with pagination
     */
    async getAllBookingOrders(filters = {}) {
        try {
            const {
                user_id,
                status,
                start_date,
                end_date,
                page = 1,
                limit = 20
            } = filters;

            const query = {};

            if (user_id) {
                query.user_id = user_id;
            }

            if (status) {
                query.status = status;
            }

            if (start_date || end_date) {
                query.createdAt = {};
                if (start_date) {
                    query.createdAt.$gte = new Date(start_date);
                }
                if (end_date) {
                    query.createdAt.$lte = new Date(end_date);
                }
            }

            const skip = (page - 1) * limit;

            const [orders, total] = await Promise.all([
                BookingOrder.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                BookingOrder.countDocuments(query)
            ]);

            // Get bookings count for each order
            const ordersWithCounts = await Promise.all(
                orders.map(async (order) => {
                    const bookingsCount = await Booking.countDocuments({ order_id: order.id });
                    return {
                        ...order,
                        bookings_count: bookingsCount
                    };
                })
            );

            return {
                orders: ordersWithCounts,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Cancel booking order
     * Uses transaction to ensure both order and bookings are cancelled together
     * @param {String} orderId - Order ID
     * @returns {Promise<Object>} Cancelled order
     */
    async cancelBookingOrder(orderId) {
        const session = await mongoose.startSession();

        try {
            return await session.withTransaction(async () => {
                const order = await BookingOrder.findOne({ id: orderId }).session(session);

                if (!order) {
                    const error = new Error("Booking order not found");
                    error.statusCode = 404;
                    throw error;
                }

                if (order.status === 'CANCELLED') {
                    const error = new Error("Order is already cancelled");
                    error.statusCode = 400;
                    throw error;
                }

                if (order.status === 'PAID') {
                    const error = new Error("Cannot cancel paid order");
                    error.statusCode = 400;
                    throw error;
                }

                // Cancel all bookings in this order within transaction
                await Booking.updateMany(
                    { order_id: orderId, status: 'BOOKED' },
                    { $set: { status: 'CANCELLED' } }
                ).session(session);

                // Cancel the order within transaction
                order.status = 'CANCELLED';
                await order.save({ session });

                return order;
            });
        } catch (error) {
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Mark order as paid
     * @param {String} orderId - Order ID
     * @returns {Promise<Object>} Updated order
     */
    async markOrderAsPaid(orderId) {
        try {
            const order = await BookingOrder.findOne({ id: orderId });

            if (!order) {
                const error = new Error("Booking order not found");
                error.statusCode = 404;
                throw error;
            }

            if (order.status !== 'PENDING') {
                const error = new Error(`Cannot mark order as paid from ${order.status} status`);
                error.statusCode = 400;
                throw error;
            }

            order.status = 'PAID';
            await order.save();

            return order;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new BookingOrderService();
