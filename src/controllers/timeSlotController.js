const timeSlotService = require("../services/timeSlotService");

// @desc    Create a new time slot
// @route   POST /api/timeslots
// @access  Private (Admin/Manager)
exports.createTimeSlot = async (req, res) => {
    try {
        const timeSlot = await timeSlotService.createTimeSlot(req.body);

        res.status(201).json({
            success: true,
            message: "Time slot created successfully",
            data: timeSlot,
        });
    } catch (error) {
        console.error("Create time slot error:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error creating time slot",
        });
    }
};

// @desc    Get all time slots
// @route   GET /api/timeslots
// @access  Public
exports.getAllTimeSlots = async (req, res) => {
    try {
        const { pod_id, status, start_date, end_date } = req.query;

        const timeSlots = await timeSlotService.getAllTimeSlots({
            pod_id,
            status,
            start_date,
            end_date
        });

        res.status(200).json({
            success: true,
            count: timeSlots.length,
            data: timeSlots,
        });
    } catch (error) {
        console.error("Get time slots error:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching time slots",
            error: error.message,
        });
    }
};

// @desc    Get available time slots for a pod
// @route   GET /api/timeslots/available/:podId
// @access  Public
exports.getAvailableSlots = async (req, res) => {
    try {
        const { podId } = req.params;
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: "start_date and end_date query parameters are required",
            });
        }

        const slots = await timeSlotService.getAvailableSlots(podId, start_date, end_date);

        res.status(200).json({
            success: true,
            count: slots.length,
            data: slots,
        });
    } catch (error) {
        console.error("Get available slots error:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching available slots",
            error: error.message,
        });
    }
};

// @desc    Get time slot by ID
// @route   GET /api/timeslots/:id
// @access  Public
exports.getTimeSlotById = async (req, res) => {
    try {
        const timeSlot = await timeSlotService.getTimeSlotById(req.params.id);

        res.status(200).json({
            success: true,
            data: timeSlot,
        });
    } catch (error) {
        console.error("Get time slot error:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error fetching time slot",
        });
    }
};

// @desc    Update time slot
// @route   PUT /api/timeslots/:id
// @access  Private (Admin/Manager)
exports.updateTimeSlot = async (req, res) => {
    try {
        const timeSlot = await timeSlotService.updateTimeSlot(req.params.id, req.body);

        res.status(200).json({
            success: true,
            message: "Time slot updated successfully",
            data: timeSlot,
        });
    } catch (error) {
        console.error("Update time slot error:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error updating time slot",
        });
    }
};

// @desc    Delete time slot
// @route   DELETE /api/timeslots/:id
// @access  Private (Admin/Manager)
exports.deleteTimeSlot = async (req, res) => {
    try {
        const result = await timeSlotService.deleteTimeSlot(req.params.id);

        res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (error) {
        console.error("Delete time slot error:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error deleting time slot",
        });
    }
};

// @desc    Generate time slots for a pod
// @route   POST /api/timeslots/generate/:podId
// @access  Private (Admin/Manager)
exports.generateSlotsForPod = async (req, res) => {
    try {
        const { podId } = req.params;
        const { days } = req.body;

        const slots = await timeSlotService.generateSlotsForPod(podId, days || 7);

        res.status(201).json({
            success: true,
            message: `Successfully generated ${slots.length} time slots`,
            count: slots.length,
            data: slots,
        });
    } catch (error) {
        console.error("Generate time slots error:", error);
        res.status(500).json({
            success: false,
            message: "Error generating time slots",
            error: error.message,
        });
    }
};

// @desc    Reserve time slots
// @route   POST /api/timeslots/reserve
// @access  Private
exports.reserveSlots = async (req, res) => {
    try {
        const { slotIds } = req.body;

        if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "slotIds array is required",
            });
        }

        const result = await timeSlotService.reserveSlots(slotIds);

        res.status(200).json({
            success: true,
            message: result.message,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error("Reserve slots error:", error);
        res.status(500).json({
            success: false,
            message: "Error reserving time slots",
            error: error.message,
        });
    }
};

// @desc    Release reserved time slots
// @route   POST /api/timeslots/release
// @access  Private
exports.releaseSlots = async (req, res) => {
    try {
        const { slotIds } = req.body;

        if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "slotIds array is required",
            });
        }

        const result = await timeSlotService.releaseSlots(slotIds);

        res.status(200).json({
            success: true,
            message: result.message,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error("Release slots error:", error);
        res.status(500).json({
            success: false,
            message: "Error releasing time slots",
            error: error.message,
        });
    }
};

// @desc    Find available slots by cluster using gap-based logic
// @route   GET /api/timeslots/cluster/:clusterId/available
// @access  Public
exports.findAvailableSlotsByCluster = async (req, res) => {
    try {
        const { clusterId } = req.params;
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: "date query parameter is required (format: YYYY-MM-DD)",
            });
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format. Use YYYY-MM-DD",
            });
        }

        const result = await timeSlotService.findAvailableSlotsByCluster(clusterId, date);

        res.status(200).json({
            success: true,
            message: "Available slots retrieved successfully",
            data: result
        });
    } catch (error) {
        console.error("Find available slots by cluster error:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.message || "Error finding available slots",
        });
    }
};
