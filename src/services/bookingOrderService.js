const BookingOrder = require("../models/BookingOrder");
const Booking = require("../models/Bookings");
const PodCluster = require("../models/PodCluster");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const Location = require("../models/Location");
const mongoose = require("mongoose");
const timeSlotService = require("./timeSlotService");

// Slot configuration
const DEFAULT_SLOT_DURATION_MINUTES = 30;
const HOLD_EXPIRATION_MINUTES = 3;
const MINIMUM_DURATION_MINUTES = 60; // Minimum booking: 1 hour


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
            require_adjacent = false,
            floor_preference = null,
            accept_fragmented = false,
            accept_mixed_floor = false
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

                // Get location details
                const location = await Location.findOne({ id: cluster.location_id });
                if (!location) {
                    const error = new Error("Location not found for this cluster");
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

                // Select pods to book based on preferences
                const podsToBook = this._selectPodsForBooking(
                    availablePods,
                    pod_count,
                    require_adjacent,
                    floor_preference,
                    accept_fragmented,
                    accept_mixed_floor
                );

                // Calculate duration in minutes
                const durationMs = endDate - startDate;
                const durationMinutes = Math.ceil(durationMs / (1000 * 60));
                const durationHours = durationMinutes / 60;
                const slotDurationMinutes = cluster.slot_duration_minutes || DEFAULT_SLOT_DURATION_MINUTES;

                // Validate minimum booking duration (1 hour)
                if (durationMinutes < MINIMUM_DURATION_MINUTES) {
                    const error = new Error(`Minimum booking duration is ${MINIMUM_DURATION_MINUTES} minutes (1 hour)`);
                    error.statusCode = 400;
                    throw error;
                }

                // Enforce booking duration to align with configured slot size of this cluster
                if (durationMinutes % slotDurationMinutes !== 0) {
                    const error = new Error(
                        `Booking duration must be a multiple of ${slotDurationMinutes} minutes for this pod cluster`
                    );
                    error.statusCode = 400;
                    throw error;
                }

                // Calculate pricing
                // base_price_modifier is the price per configured slot of this pod cluster
                const pricePerSlot = cluster.base_price_modifier || 0;
                const numberOfSlots = durationMinutes / slotDurationMinutes;

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
                    // Generate slots based on cluster slot configuration
                    const timeSlotDocs = this._generateTimeSlots(
                        booking.pod_id,
                        new Date(booking.start_time),
                        new Date(booking.end_time),
                        slotDurationMinutes
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
                        cluster_name: cluster.name,
                        location_id: location.id,
                        location_name: location.name,
                        start_time: startDate,
                        end_time: endDate,
                        duration_minutes: durationMinutes,
                        duration_hours: durationHours,
                        slot_duration_minutes: slotDurationMinutes,
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
     * Select pods based on adjacency requirements and floor preference
     * @private
     */
    _selectPodsForBooking(availablePods, podCount, requireAdjacent, floorPreference, acceptFragmented, acceptMixedFloor) {
        // Tổng kiểm tra (Total check)
        if (availablePods.length < podCount) {
            const error = new Error(`Chưa đủ ${podCount} pod trống trong khung giờ này.`);
            error.statusCode = 409;
            error.code = 'OUT_OF_STOCK';
            throw error;
        }

        // Parse Codes
        const podInfo = availablePods.map(pod => {
            const code = pod.code || '';
            const match = code.match(/^([a-zA-Z]*)(\d+)([a-zA-Z]*)$/);
            return {
                pod,
                prefix: match ? match[1].toUpperCase() : 'UNKNOWN',
                number: match ? parseInt(match[2], 10) : 0,
                suffix: match ? match[3].toUpperCase() : 'UNKNOWN',
                originalCode: code
            };
        });

        let bestSelection = [];

        // Bước 1: Lọc lầu (Floor Filter)
        if (floorPreference && (floorPreference === 'U' || floorPreference === 'L')) {
            const preferredPods = podInfo.filter(info => info.suffix === floorPreference);

            if (preferredPods.length >= podCount) {
                // Đủ số lượng trên lầu ưu tiên
                bestSelection = preferredPods;
            } else {
                // Thiếu trên lầu ưu tiên, hỏi người dùng hoặc nếu đã acceptMixedFloor thì lấy trộn
                if (!acceptMixedFloor) {
                    const otherPods = podInfo.filter(info => info.suffix !== floorPreference);
                    const msg = `Chỉ còn ${preferredPods.length} pod trống trên lầu ${floorPreference === 'U' ? 'trên' : 'dưới'} (cần ${podCount}). Hiện đang còn trống ở lầu khác, bạn có đồng ý trộn lầu hoặc đổi lầu không?`;
                    const error = new Error(msg);
                    error.statusCode = 409;
                    error.code = 'CONFIRMATION_REQUIRED_MIXED_FLOOR';
                    error.data = {
                        preferred_floor_count: preferredPods.length,
                        other_floor_count: otherPods.length,
                        total_available: availablePods.length
                    };
                    throw error;
                } else {
                    bestSelection = podInfo;
                }
            }
        } else {
            bestSelection = podInfo;
        }

        // Bước 2 & Bước 3: Kiểm tra liền kề (Adjacency Check)
        if (requireAdjacent && podCount > 1) {
            const groups = {};
            bestSelection.forEach(info => {
                const key = `${info.prefix}_${info.suffix}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push(info);
            });

            let allSegments = [];
            for (const key in groups) {
                const groupPods = groups[key].sort((a, b) => a.number - b.number);
                if (groupPods.length === 0) continue;

                let currentSegment = [groupPods[0]];
                for (let i = 1; i < groupPods.length; i++) {
                    if (groupPods[i].number === groupPods[i - 1].number + 1) {
                        currentSegment.push(groupPods[i]);
                    } else {
                        allSegments.push({ key, pods: currentSegment, length: currentSegment.length });
                        currentSegment = [groupPods[i]];
                    }
                }
                allSegments.push({ key, pods: currentSegment, length: currentSegment.length });
            }

            // Xếp các đoạn (segments) giảm dần theo độ dài
            allSegments.sort((a, b) => b.length - a.length);

            // Cố tìm 1 cụm liên tục N
            const perfectSegment = allSegments.find(seg => seg.length >= podCount);
            if (perfectSegment) {
                return perfectSegment.pods.slice(0, podCount).map(info => info.pod);
            }

            // Nếu phải chia thành nhiều cụm (Vơ cạn - Fragmented)
            // Lấy các khối cần thiết ghép lại
            let selectedPods = [];
            let breakdownDescriptions = [];
            let needed = podCount;

            for (const seg of allSegments) {
                const take = Math.min(seg.length, needed);
                if (take > 0) {
                    selectedPods = selectedPods.concat(seg.pods.slice(0, take));

                    const codeDisplays = seg.pods.slice(0, take).map(p => p.originalCode).join(', ');
                    breakdownDescriptions.push(`${take} pod khu ${seg.key} (${codeDisplays})`);

                    needed -= take;
                }
                if (needed === 0) break;
            }

            if (!acceptFragmented) {
                const msg = `Chúng tôi không tìm được dãy ${podCount} pod liền kề. Phương án tốt nhất hiện có là: ${breakdownDescriptions.join(' và ')}. Bạn có đồng ý không?`;
                const error = new Error(msg);
                error.statusCode = 409;
                error.code = 'CONFIRMATION_REQUIRED_FRAGMENTED';
                error.data = {
                    breakdown: breakdownDescriptions,
                    clusters: breakdownDescriptions.length
                };
                throw error;
            }

            // Nếu khách accept, chọn tổ hợp vừa tìm
            return selectedPods.map(info => info.pod);
        }

        // Default behavior: ưu tiên pod có last_cleaned_at cũ nhất
        // Nếu last_cleaned_at là null, đó là pod mới hoàn toàn -> ưu tiên đầu tiên (hoặc coi như rất cũ)
        bestSelection.sort((a, b) => {
            const timeA = a.pod.last_cleaned_at ? new Date(a.pod.last_cleaned_at).getTime() : 0;
            const timeB = b.pod.last_cleaned_at ? new Date(b.pod.last_cleaned_at).getTime() : 0;
            return timeA - timeB; // Sắp xếp tăng dần: thời gian cũ nhất sẽ lêm trước
        });

        return bestSelection.slice(0, podCount).map(info => info.pod);
    }

    /**
     * Generate time slot documents for a booking time range
     * @private
     * @param {String} podId - Pod ID
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @param {Number} slotDurationMinutes - Slot duration in minutes
     * @returns {Array} Array of time slot documents
     */
    _generateTimeSlots(podId, startTime, endTime, slotDurationMinutes = DEFAULT_SLOT_DURATION_MINUTES) {
        const slots = [];
        let currentStart = new Date(startTime);

        while (currentStart < endTime) {
            const currentEnd = new Date(currentStart);
            currentEnd.setMinutes(currentEnd.getMinutes() + slotDurationMinutes);

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
            const bookings = await Booking.find({ order_id: orderId }).lean();

            // Manually fetch pod details for each booking (since pod uses custom 'id' field)
            const podIds = [...new Set(bookings.map(b => b.pod_id))];
            const pods = await Pod.find({ id: { $in: podIds } }).lean();
            const podMap = pods.reduce((map, pod) => {
                map[pod.id] = pod;
                return map;
            }, {});

            // Attach pod details to bookings
            const bookingsWithPods = bookings.map(booking => ({
                ...booking,
                pod: podMap[booking.pod_id] || null
            }));

            // Get pod cluster info from booked pods (all pods should belong to the same cluster)
            const clusterIds = [
                ...new Set(
                    pods
                        .map(pod => pod.cluster_id)
                        .filter(Boolean)
                )
            ];

            const podcluster = clusterIds.length > 0
                ? await PodCluster.findOne({ id: clusterIds[0] }).lean()
                : null;

            return {
                order,
                bookings: bookingsWithPods,
                podcluster
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

                // Get all bookings for this order
                const bookings = await Booking.find({ order_id: orderId }).session(session);

                // Release time slots for each booking
                for (const booking of bookings) {
                    // Get all booking slots
                    const bookingSlots = await BookingSlot.find({ booking_id: booking.id }).session(session);
                    const timeSlotIds = bookingSlots.map(bs => bs.time_slot_id);

                    // Delete time slots (release them)
                    if (timeSlotIds.length > 0) {
                        await TimeSlot.deleteMany({ id: { $in: timeSlotIds } }).session(session);
                    }

                    // Delete booking slots
                    await BookingSlot.deleteMany({ booking_id: booking.id }).session(session);
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

    /**
     * Cleanup expired PENDING orders
     * Orders that have been PENDING for more than HOLD_EXPIRATION_MINUTES are cancelled
     * @returns {Promise<Object>} Cleanup result
     */
    async cleanupExpiredOrders() {
        try {
            const expirationTime = new Date();
            expirationTime.setMinutes(expirationTime.getMinutes() - HOLD_EXPIRATION_MINUTES);

            // Find all expired PENDING orders
            const expiredOrders = await BookingOrder.find({
                status: 'PENDING',
                createdAt: { $lt: expirationTime }
            });

            console.log(`Found ${expiredOrders.length} expired order(s) to cleanup`);

            let cancelledCount = 0;
            for (const order of expiredOrders) {
                try {
                    console.log(`Cleaning up expired order ${order.id}...`);

                    // Get all bookings for this order
                    const bookings = await Booking.find({ order_id: order.id });

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
                        { order_id: order.id },
                        { $set: { status: 'CANCELLED' } }
                    );

                    // Update order status to CANCELLED
                    order.status = 'CANCELLED';
                    await order.save();

                    cancelledCount++;
                    console.log(`Order ${order.id} cancelled and slots released.`);
                } catch (err) {
                    console.error(`Error cleaning up order ${order.id}:`, err);
                }
            }

            return {
                found: expiredOrders.length,
                cancelled: cancelledCount
            };
        } catch (error) {
            console.error('Error in cleanupExpiredOrders:', error);
            throw error;
        }
    }

    /**
     * Start periodic cleanup job
     * Runs every minute to clean up expired PENDING orders
     * @param {Number} intervalMinutes - Interval in minutes (default: 1)
     */
    startCleanupJob(intervalMinutes = 1) {
        console.log(`Starting order cleanup job (interval: ${intervalMinutes} minute(s))`);

        // Run immediately on startup
        this.cleanupExpiredOrders().catch(err =>
            console.error('Initial cleanup failed:', err)
        );

        // Then run periodically
        setInterval(async () => {
            try {
                await this.cleanupExpiredOrders();
            } catch (error) {
                console.error('Cleanup job error:', error);
            }
        }, intervalMinutes * 60 * 1000);
    }
}

module.exports = new BookingOrderService();
