const { TimeSlot, Pod, PodCluster, Location, Booking } = require("../models");

// Operating hours configuration
const MALL_HOURS = {
    start: 8,  // 8:00 AM
    end: 22    // 10:00 PM
};

const FULL_TIME_HOURS = {
    start: 0,  // 12:00 AM (midnight)
    end: 24    // 24/7 - full day
};

const SLOT_DURATION_MINUTES = 30;
const BUFFER_MINUTES = 30; // Buffer time for cleaning between bookings

class TimeSlotService {
    /**
     * Get operating hours for a pod based on its location type
     * Check parent location if current location has parent_id
     * @param {Object} location - Location object
     * @returns {Promise<Object>} Operating hours {start, end}
     */
    async getOperatingHours(location) {
        if (!location) {
            return FULL_TIME_HOURS;
        }

        // If location has parent_id, get parent location to check type
        let locationToCheck = location;
        if (location.parent_id) {
            const parentLocation = await Location.findOne({ id: location.parent_id });
            if (parentLocation) {
                locationToCheck = parentLocation;
            }
        }

        // Check if parent (or current) location type is mall
        if (locationToCheck.type === 'mall') {
            return MALL_HOURS;
        }

        return FULL_TIME_HOURS;
    }

    /**
     * Generate time slots for a specific pod
     * @param {String} podId - Pod ID
     * @param {Number} days - Number of days to generate (default: 7)
     * @returns {Array} Array of created time slots
     */
    // async generateTimeSlotsForPod(podId, days = 7) {
    //     try {
    //         // Get pod and populate cluster and location
    //         const pod = await Pod.findOne({ id: podId });
    //         if (!pod) {
    //             throw new Error("Pod not found");
    //         }

    //         const cluster = await PodCluster.findOne({ id: pod.cluster_id });
    //         if (!cluster) {
    //             throw new Error("Pod cluster not found");
    //         }

    //         const location = await Location.findOne({ id: cluster.location_id });
    //         if (!location) {
    //             throw new Error("Location not found");
    //         }

    //         const operatingHours = await this.getOperatingHours(location);
    //         const slots = [];

    //         // Start from tomorrow at 00:00:00
    //         const startDate = new Date();
    //         startDate.setDate(startDate.getDate() + 1);
    //         startDate.setHours(0, 0, 0, 0);

    //         for (let day = 0; day < days; day++) {
    //             const currentDate = new Date(startDate);
    //             currentDate.setDate(currentDate.getDate() + day);

    //             // Set to start of operating hours
    //             currentDate.setHours(operatingHours.start, 0, 0, 0);

    //             // Generate slots for the day
    //             while (currentDate.getHours() < operatingHours.end) {
    //                 const startTime = new Date(currentDate);
    //                 const endTime = new Date(currentDate);
    //                 endTime.setMinutes(endTime.getMinutes() + SLOT_DURATION_MINUTES);

    //                 // Only create slot if it's within operating hours
    //                 if (endTime.getHours() <= operatingHours.end || operatingHours.end === 24) {
    //                     slots.push({
    //                         pod_id: pod.id,
    //                         start_time: startTime,
    //                         end_time: endTime,
    //                         status: 'AVAILABLE'
    //                     });
    //                 }

    //                 // Move to next slot
    //                 currentDate.setMinutes(currentDate.getMinutes() + SLOT_DURATION_MINUTES);
    //             }
    //         }

    //         // Insert slots in batches
    //         if (slots.length > 0) {
    //             const batchSize = 100;
    //             const createdSlots = [];

    //             for (let i = 0; i < slots.length; i += batchSize) {
    //                 const batch = slots.slice(i, i + batchSize);
    //                 const inserted = await TimeSlot.insertMany(batch);
    //                 createdSlots.push(...inserted);
    //             }

    //             return createdSlots;
    //         }

    //         return [];
    //     } catch (error) {
    //         console.error("Error generating time slots:", error);
    //         throw error;
    //     }
    // }

    /**
     * Create a new time slot
     * @param {Object} data - Time slot data
     * @returns {Object} Created time slot
     */
    async createTimeSlot(data) {
        try {
            const { pod_id, start_time, end_time, status } = data;

            // Validate pod exists
            const pod = await Pod.findOne({ id: pod_id });
            if (!pod) {
                const error = new Error("Pod not found");
                error.statusCode = 404;
                throw error;
            }

            // Validate time
            if (new Date(end_time) <= new Date(start_time)) {
                const error = new Error("End time must be after start time");
                error.statusCode = 400;
                throw error;
            }

            // Check for overlapping slots
            const overlapping = await TimeSlot.findOne({
                pod_id,
                $or: [
                    {
                        start_time: { $lt: new Date(end_time) },
                        end_time: { $gt: new Date(start_time) }
                    }
                ]
            });

            if (overlapping) {
                const error = new Error("Time slot overlaps with existing slot");
                error.statusCode = 409;
                throw error;
            }

            const timeSlot = await TimeSlot.create({
                pod_id,
                start_time,
                end_time,
                status: status || 'AVAILABLE'
            });

            return timeSlot;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get all time slots with filters
     * @param {Object} filters - Query filters
     * @returns {Array} Array of time slots
     */
    async getAllTimeSlots(filters = {}) {
        try {
            const { pod_id, status, start_date, end_date } = filters;
            const query = {};

            if (pod_id) {
                query.pod_id = pod_id;
            }

            if (status) {
                query.status = status;
            }

            if (start_date || end_date) {
                query.start_time = {};
                if (start_date) {
                    query.start_time.$gte = new Date(start_date);
                }
                if (end_date) {
                    query.start_time.$lte = new Date(end_date);
                }
            }

            const timeSlots = await TimeSlot.find(query)
                .sort({ start_time: 1 })
                .lean();

            return timeSlots;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get available time slots for a pod
     * @param {String} podId - Pod ID
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Array} Array of available time slots
     */
    async getAvailableSlots(podId, startDate, endDate) {
        try {
            const query = {
                pod_id: podId,
                status: 'AVAILABLE',
                start_time: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };

            const slots = await TimeSlot.find(query)
                .sort({ start_time: 1 })
                .lean();

            return slots;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get time slot by ID
     * @param {String} id - Time slot ID
     * @returns {Object} Time slot
     */
    async getTimeSlotById(id) {
        try {
            const timeSlot = await TimeSlot.findOne({ id }).lean();

            if (!timeSlot) {
                const error = new Error("Time slot not found");
                error.statusCode = 404;
                throw error;
            }

            return timeSlot;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Update time slot
     * @param {String} id - Time slot ID
     * @param {Object} data - Update data
     * @returns {Object} Updated time slot
     */
    async updateTimeSlot(id, data) {
        try {
            const timeSlot = await TimeSlot.findOne({ id });

            if (!timeSlot) {
                const error = new Error("Time slot not found");
                error.statusCode = 404;
                throw error;
            }

            // Validate time if being updated
            if (data.start_time || data.end_time) {
                const startTime = data.start_time ? new Date(data.start_time) : timeSlot.start_time;
                const endTime = data.end_time ? new Date(data.end_time) : timeSlot.end_time;

                if (endTime <= startTime) {
                    const error = new Error("End time must be after start time");
                    error.statusCode = 400;
                    throw error;
                }
            }

            // Update fields
            if (data.start_time) timeSlot.start_time = data.start_time;
            if (data.end_time) timeSlot.end_time = data.end_time;
            if (data.status) timeSlot.status = data.status;

            await timeSlot.save();

            return timeSlot;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Delete time slot
     * @param {String} id - Time slot ID
     * @returns {Object} Result
     */
    async deleteTimeSlot(id) {
        try {
            const timeSlot = await TimeSlot.findOne({ id });

            if (!timeSlot) {
                const error = new Error("Time slot not found");
                error.statusCode = 404;
                throw error;
            }

            // Don't allow deleting reserved slots
            if (timeSlot.status === 'RESERVED') {
                const error = new Error("Cannot delete reserved time slot");
                error.statusCode = 400;
                throw error;
            }

            await TimeSlot.deleteOne({ id });

            return { message: "Time slot deleted successfully" };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Generate time slots for a pod
     * @param {String} podId - Pod ID
     * @param {Number} days - Number of days (default: 7)
     * @returns {Array} Created time slots
     */
    async generateSlotsForPod(podId, days = 7) {
        return await this.generateTimeSlotsForPod(podId, days);
    }

    /**
     * Reserve time slots
     * @param {Array} slotIds - Array of time slot IDs
     * @returns {Object} Result
     */
    async reserveSlots(slotIds) {
        try {
            const result = await TimeSlot.updateMany(
                { id: { $in: slotIds }, status: 'AVAILABLE' },
                { $set: { status: 'RESERVED' } }
            );

            return {
                message: "Time slots reserved successfully",
                modifiedCount: result.modifiedCount
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Release reserved time slots
     * @param {Array} slotIds - Array of time slot IDs
     * @returns {Object} Result
     */
    async releaseSlots(slotIds) {
        try {
            const result = await TimeSlot.updateMany(
                { id: { $in: slotIds }, status: 'RESERVED' },
                { $set: { status: 'AVAILABLE' } }
            );

            return {
                message: "Time slots released successfully",
                modifiedCount: result.modifiedCount
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Find available slots using gap-based logic
     * Returns all slots in a day with availability status
     * @param {String} clusterId - Cluster ID
     * @param {String} date - Date in format YYYY-MM-DD
     * @returns {Object} Object with date and slots array
     */
    async findAvailableSlotsByCluster(clusterId, date) {
        try {
            // Validate cluster exists
            const cluster = await PodCluster.findOne({ id: clusterId });
            if (!cluster) {
                const error = new Error("Cluster not found");
                error.statusCode = 404;
                throw error;
            }

            // Get location to determine operating hours
            const location = await Location.findOne({ id: cluster.location_id });
            const operatingHours = await this.getOperatingHours(location);

            // Get all pods in the cluster
            const pods = await Pod.find({
                cluster_id: clusterId,
                status: { $nin: ['MAINTENANCE'] } // Exclude pods under maintenance
            }).lean();

            // Parse the date and set boundaries for the day
            const targetDate = new Date(date);
            targetDate.setHours(0, 0, 0, 0);

            const startOfDay = new Date(targetDate);
            startOfDay.setHours(operatingHours.start, 0, 0, 0);

            const endOfDay = new Date(targetDate);
            if (operatingHours.end === 24) {
                endOfDay.setHours(23, 59, 59, 999);
            } else {
                endOfDay.setHours(operatingHours.end, 0, 0, 0);
            }

            // Generate all possible 30-minute slots for the day
            const allSlots = this._generateAllSlots(startOfDay, endOfDay);

            // If no pods, return all slots as unavailable
            if (pods.length === 0) {
                return {
                    date: date,
                    total_slots: allSlots.length,
                    available_slots_count: 0,
                    unavailable_slots_count: allSlots.length,
                    slots: allSlots.map(slot => ({
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        status: 'UNAVAILABLE',
                        available_pods_count: 0,
                        available_pod_ids: []
                    }))
                };
            }

            // Get all bookings for these pods on this date
            const podIds = pods.map(pod => pod.id);
            const bookings = await Booking.find({
                pod_id: { $in: podIds },
                status: { $in: ['BOOKED', 'IN_USE'] },
                start_time: { $lt: endOfDay },
                end_time: { $gt: startOfDay }
            }).lean();

            // Build a map of pod availability for each slot
            const podAvailabilityMap = new Map();

            pods.forEach(pod => {
                // Get bookings for this specific pod
                const podBookings = bookings.filter(b => b.pod_id === pod.id);

                // Calculate busy periods (bookings + buffer)
                const busyPeriods = this._calculateBusyPeriods(podBookings);

                // Find available slots (gaps) for this pod
                const availableSlots = this._findGaps(allSlots, busyPeriods);

                // Mark which slots this pod is available for
                availableSlots.forEach(slot => {
                    const slotKey = `${slot.start_time.getTime()}-${slot.end_time.getTime()}`;
                    if (!podAvailabilityMap.has(slotKey)) {
                        podAvailabilityMap.set(slotKey, {
                            start_time: slot.start_time,
                            end_time: slot.end_time,
                            available_pods: []
                        });
                    }
                    podAvailabilityMap.get(slotKey).available_pods.push({
                        pod_id: pod.id,
                        pod_code: pod.code,
                        pod_name: pod.name
                    });
                });
            });

            // Build final result with all slots
            const resultSlots = allSlots.map(slot => {
                const slotKey = `${slot.start_time.getTime()}-${slot.end_time.getTime()}`;
                const availability = podAvailabilityMap.get(slotKey);

                if (availability && availability.available_pods.length > 0) {
                    return {
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        status: 'AVAILABLE',
                        available_pods_count: availability.available_pods.length,
                        available_pods: availability.available_pods
                    };
                } else {
                    return {
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        status: 'UNAVAILABLE',
                        available_pods_count: 0,
                        available_pods: []
                    };
                }
            });

            // Calculate statistics
            const availableCount = resultSlots.filter(s => s.status === 'AVAILABLE').length;
            const unavailableCount = resultSlots.filter(s => s.status === 'UNAVAILABLE').length;

            return {
                date: date,
                cluster_id: clusterId,
                base_price_modifier: cluster.base_price_modifier || 0,
                total_pods: pods.length,
                total_slots: allSlots.length,
                available_slots_count: availableCount,
                unavailable_slots_count: unavailableCount,
                slots: resultSlots
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Generate all possible time slots for a given period
     * @private
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @returns {Array} Array of slot objects {start_time, end_time}
     */
    _generateAllSlots(startTime, endTime) {
        const slots = [];
        const current = new Date(startTime);

        while (current < endTime) {
            const slotStart = new Date(current);
            const slotEnd = new Date(current);
            slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_DURATION_MINUTES);

            // Only add slot if it ends within operating hours
            if (slotEnd <= endTime) {
                slots.push({
                    start_time: new Date(slotStart),
                    end_time: new Date(slotEnd)
                });
            }

            current.setMinutes(current.getMinutes() + SLOT_DURATION_MINUTES);
        }

        return slots;
    }

    /**
     * Calculate busy periods from bookings including buffer time
     * @private
     * @param {Array} bookings - Array of bookings
     * @returns {Array} Array of busy periods {start, end}
     */
    _calculateBusyPeriods(bookings) {
        if (bookings.length === 0) return [];

        const busyPeriods = bookings.map(booking => {
            const start = new Date(booking.start_time);
            const end = new Date(booking.end_time);

            // Add buffer time after the booking
            end.setMinutes(end.getMinutes() + BUFFER_MINUTES);

            return { start, end };
        });

        // Sort by start time
        busyPeriods.sort((a, b) => a.start - b.start);

        // Merge overlapping periods
        const merged = [];
        let current = busyPeriods[0];

        for (let i = 1; i < busyPeriods.length; i++) {
            const next = busyPeriods[i];

            if (next.start <= current.end) {
                // Overlapping or adjacent, merge them
                current.end = new Date(Math.max(current.end, next.end));
            } else {
                // No overlap, save current and move to next
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);

        return merged;
    }

    /**
     * Find gaps (available slots) between busy periods
     * @private
     * @param {Array} allSlots - All possible slots
     * @param {Array} busyPeriods - Busy periods
     * @returns {Array} Available slots
     */
    _findGaps(allSlots, busyPeriods) {
        if (busyPeriods.length === 0) {
            return allSlots;
        }

        return allSlots.filter(slot => {
            // Check if this slot overlaps with any busy period
            for (const busy of busyPeriods) {
                // A slot is busy if it overlaps with a busy period
                if (slot.start_time < busy.end && slot.end_time > busy.start) {
                    return false; // This slot is busy
                }
            }
            return true; // This slot is available
        });
    }
}

// Export singleton instance
const timeSlotService = new TimeSlotService();

// Export the method directly for backward compatibility (used in Pod model)
module.exports = timeSlotService;
module.exports.generateTimeSlotsForPod = (podId, days) => timeSlotService.generateTimeSlotsForPod(podId, days);
