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
		const shiftName = data.shift_name ? String(data.shift_name).toUpperCase() : data.shift_name;
		
		let startTime = data.start_time;
		let endTime = data.end_time;

		if (shiftName === "CA SÁNG") { startTime = "06:00"; endTime = "12:00"; }
		else if (shiftName === "CA CHIỀU") { startTime = "12:00"; endTime = "18:00"; }
		else if (shiftName === "CA TỐI") { startTime = "18:00"; endTime = "00:00"; }
		else if (shiftName === "CA ĐÊM") { startTime = "00:00"; endTime = "06:00"; }

		const payload = {
			role: data.role ? String(data.role).toUpperCase() : data.role,
			shift_name: shiftName,
			start_time: startTime,
			end_time: endTime,
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
			const shiftName = String(data.shift_name).toUpperCase();
			shift.shift_name = shiftName;
			
			if (shiftName === "CA SÁNG") { shift.start_time = "06:00"; shift.end_time = "12:00"; }
			else if (shiftName === "CA CHIỀU") { shift.start_time = "12:00"; shift.end_time = "18:00"; }
			else if (shiftName === "CA TỐI") { shift.start_time = "18:00"; shift.end_time = "00:00"; }
			else if (shiftName === "CA ĐÊM") { shift.start_time = "00:00"; shift.end_time = "06:00"; }
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
