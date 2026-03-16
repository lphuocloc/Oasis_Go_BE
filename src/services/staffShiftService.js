const StaffShift = require("../models/StaffShift");

class StaffShiftService {
	async getAllStaffShifts(filters = {}) {
		const query = {};

		if (filters.role) {
			query.role = String(filters.role).toUpperCase();
		}

		if (filters.is_active !== undefined) {
			query.is_active = String(filters.is_active) === "true";
		}

		return StaffShift.find(query).sort({ created_at: -1 });
	}

	async getStaffShiftById(id) {
		const shift = await StaffShift.findOne({ id });
		if (!shift) {
			const error = new Error("Staff shift not found");
			error.statusCode = 404;
			throw error;
		}

		return shift;
	}

	async createStaffShift(data) {
		const payload = {
			role: data.role ? String(data.role).toUpperCase() : data.role,
			shift_name: data.shift_name ? String(data.shift_name).toUpperCase() : data.shift_name,
			start_time: data.start_time,
			end_time: data.end_time,
			is_active: data.is_active !== undefined ? data.is_active : true,
		};

		try {
			return await StaffShift.create(payload);
		} catch (error) {
			if (error && error.code === 11000) {
				const duplicateError = new Error("Staff shift already exists for this role and shift_name");
				duplicateError.statusCode = 409;
				throw duplicateError;
			}
			throw error;
		}
	}

	async updateStaffShift(id, data) {
		const shift = await this.getStaffShiftById(id);

		if (data.role !== undefined) {
			shift.role = String(data.role).toUpperCase();
		}

		if (data.shift_name !== undefined) {
			shift.shift_name = String(data.shift_name).toUpperCase();
		}

		if (data.start_time !== undefined) {
			shift.start_time = data.start_time;
		}

		if (data.end_time !== undefined) {
			shift.end_time = data.end_time;
		}

		if (data.is_active !== undefined) {
			shift.is_active = data.is_active;
		}

		try {
			await shift.save();
		} catch (error) {
			if (error && error.code === 11000) {
				const duplicateError = new Error("Staff shift already exists for this role and shift_name");
				duplicateError.statusCode = 409;
				throw duplicateError;
			}
			throw error;
		}

		return shift;
	}

	async deleteStaffShift(id) {
		const shift = await this.getStaffShiftById(id);
		await StaffShift.deleteOne({ id });
		return shift;
	}
}

module.exports = new StaffShiftService();
