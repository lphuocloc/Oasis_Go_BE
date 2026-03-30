const staffShiftService = require("../services/staffShiftService");

const getAllStaffShifts = async (req, res) => {
	try {
		const shifts = await staffShiftService.getAllStaffShifts(req.query);
		res.status(200).json({
			success: true,
			count: shifts.length,
			data: shifts,
		});
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			message: error.message || "Failed to get staff shifts",
		});
	}
};

const getStaffShiftById = async (req, res) => {
	try {
		const shift = await staffShiftService.getStaffShiftById(req.params.id);
		res.status(200).json({
			success: true,
			data: shift,
		});
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			message: error.message || "Failed to get staff shift",
		});
	}
};

const createStaffShift = async (req, res) => {
	try {
		if (req.user && req.user.role === "manager") {
			if (req.body.role !== "CLEANER") {
				return res.status(403).json({ success: false, message: "Managers can only create CLEANER shifts" });
			}
		}

		const shift = await staffShiftService.createStaffShift(req.body);
		res.status(201).json({
			success: true,
			message: "Staff shift created successfully",
			data: shift,
		});
	} catch (error) {
		res.status(error.statusCode || 400).json({
			success: false,
			message: error.message || "Failed to create staff shift",
		});
	}
};

const updateStaffShift = async (req, res) => {
	try {
		if (req.user && req.user.role === "manager") {
			const existingShift = await staffShiftService.getStaffShiftById(req.params.id);
			if (existingShift.role !== "CLEANER") {
				return res.status(403).json({ success: false, message: "Managers can only update CLEANER shifts" });
			}
			if (req.body.role && req.body.role !== "CLEANER") {
				return res.status(403).json({ success: false, message: "Managers cannot change shift role to non-CLEANER" });
			}
		}

		const shift = await staffShiftService.updateStaffShift(req.params.id, req.body);
		res.status(200).json({
			success: true,
			message: "Staff shift updated successfully",
			data: shift,
		});
	} catch (error) {
		res.status(error.statusCode || 400).json({
			success: false,
			message: error.message || "Failed to update staff shift",
		});
	}
};

const deleteStaffShift = async (req, res) => {
	try {
		if (req.user && req.user.role === "manager") {
			const existingShift = await staffShiftService.getStaffShiftById(req.params.id);
			if (existingShift.role !== "CLEANER") {
				return res.status(403).json({ success: false, message: "Managers can only delete CLEANER shifts" });
			}
		}

		await staffShiftService.deleteStaffShift(req.params.id);
		res.status(200).json({
			success: true,
			message: "Staff shift deleted successfully",
		});
	} catch (error) {
		res.status(error.statusCode || 400).json({
			success: false,
			message: error.message || "Failed to delete staff shift",
		});
	}
};

module.exports = {
	getAllStaffShifts,
	getStaffShiftById,
	createStaffShift,
	updateStaffShift,
	deleteStaffShift,
};
