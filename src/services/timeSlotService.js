const { TimeSlot, Pod, PodCluster, Location } = require("../models");

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
    async generateTimeSlotsForPod(podId, days = 7) {
        try {
            // Get pod and populate cluster and location
            const pod = await Pod.findOne({ id: podId });
            if (!pod) {
                throw new Error("Pod not found");
            }

            const cluster = await PodCluster.findOne({ id: pod.cluster_id });
            if (!cluster) {
                throw new Error("Pod cluster not found");
            }

            const location = await Location.findOne({ id: cluster.location_id });
            if (!location) {
                throw new Error("Location not found");
            }

            const operatingHours = await this.getOperatingHours(location);
            const slots = [];

            // Start from tomorrow at 00:00:00
            const startDate = new Date();
            startDate.setDate(startDate.getDate() + 1);
            startDate.setHours(0, 0, 0, 0);

            for (let day = 0; day < days; day++) {
                const currentDate = new Date(startDate);
                currentDate.setDate(currentDate.getDate() + day);

                // Set to start of operating hours
                currentDate.setHours(operatingHours.start, 0, 0, 0);

                // Generate slots for the day
                while (currentDate.getHours() < operatingHours.end) {
                    const startTime = new Date(currentDate);
                    const endTime = new Date(currentDate);
                    endTime.setMinutes(endTime.getMinutes() + SLOT_DURATION_MINUTES);

                    // Only create slot if it's within operating hours
                    if (endTime.getHours() <= operatingHours.end || operatingHours.end === 24) {
                        slots.push({
                            pod_id: pod.id,
                            start_time: startTime,
                            end_time: endTime,
                            status: 'AVAILABLE'
                        });
                    }

                    // Move to next slot
                    currentDate.setMinutes(currentDate.getMinutes() + SLOT_DURATION_MINUTES);
                }
            }

            // Insert slots in batches
            if (slots.length > 0) {
                const batchSize = 100;
                const createdSlots = [];

                for (let i = 0; i < slots.length; i += batchSize) {
                    const batch = slots.slice(i, i + batchSize);
                    const inserted = await TimeSlot.insertMany(batch);
                    createdSlots.push(...inserted);
                }

                return createdSlots;
            }

            return [];
        } catch (error) {
            console.error("Error generating time slots:", error);
            throw error;
        }
    }

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
}

// Export singleton instance
const timeSlotService = new TimeSlotService();

// Export the method directly for backward compatibility (used in Pod model)
module.exports = timeSlotService;
module.exports.generateTimeSlotsForPod = (podId, days) => timeSlotService.generateTimeSlotsForPod(podId, days);
