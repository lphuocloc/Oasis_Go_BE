const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const User = require("../models/User");
const mongoose = require("mongoose");

class StaffShiftAssignmentService {
  buildDateTimeFromDateAndClock(dateValue, clockValue) {
    if (!dateValue || !clockValue) {
      return null;
    }

    const [hourStr, minuteStr, secondStr = "00"] = String(clockValue).split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = Number(secondStr);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null;
    }

    const datetime = new Date(dateValue);
    datetime.setHours(hour, minute, second, 0);
    return datetime;
  }

  normalizeDateRange(startDateInput, endDateInput) {
    if (!startDateInput || !endDateInput) {
      const error = new Error("start_date and end_date are required");
      error.statusCode = 400;
      throw error;
    }

    const parsedStart = new Date(startDateInput);
    const parsedEnd = new Date(endDateInput);

    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
      const error = new Error("start_date and end_date must be valid dates (YYYY-MM-DD)");
      error.statusCode = 400;
      throw error;
    }

    const startDate = new Date(parsedStart);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(parsedEnd);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) {
      const error = new Error("start_date must be less than or equal to end_date");
      error.statusCode = 400;
      throw error;
    }

    return { startDate, endDate };
  }



  async createAssignment(data) {
    const { staff_id, location_shift_id, start_date, end_date } = data;

    if (!staff_id || !location_shift_id || !start_date || !end_date) {
      const error = new Error(
        "staff_id, location_shift_id, start_date and end_date are required"
      );
      error.statusCode = 400;
      throw error;
    }

    const { startDate, endDate } = this.normalizeDateRange(start_date, end_date);

    const [staff, locationShift] = await Promise.all([
      this.findUserById(staff_id),
      LocationShift.findOne({ id: location_shift_id }).lean(),
    ]);

    if (!staff) {
      const error = new Error("Staff not found");
      error.statusCode = 404;
      throw error;
    }

    if (!locationShift) {
      const error = new Error("Location shift not found");
      error.statusCode = 404;
      throw error;
    }

    // Get the shift to calculate checkin_at and checkout_at
    const shift = await StaffShift.findOne({ id: locationShift.shift_id }).lean();
    if (!shift) {
      const error = new Error("Shift template not found for this location shift");
      error.statusCode = 404;
      throw error;
    }

    // Check for duplicate assignment with same date range
    const existing = await StaffShiftAssignment.findOne({
      staff_id,
      location_shift_id,
      start_date: startDate,
      end_date: endDate,
    }).lean();

    if (existing) {
      const error = new Error("Assignment already exists for this staff, location shift and date range");
      error.statusCode = 409;
      throw error;
    }

    try {
      const assignment = await StaffShiftAssignment.create({
        staff_id,
        location_shift_id,
        start_date: startDate,
        end_date: endDate,
        checkin_at: this.buildDateTimeFromDateAndClock(startDate, shift.start_time),
        checkout_at: this.buildDateTimeFromDateAndClock(endDate, shift.end_time),
        status: "ASSIGNED",
      });

      return assignment;
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("Assignment already exists for this date range");
        duplicateError.statusCode = 409;
        throw duplicateError;
      }
      throw error;
    }
  }

  async getAssignments(filters = {}) {
    const query = {};

    if (filters.staff_id) {
      query.staff_id = filters.staff_id;
    }

    if (filters.location_shift_id) {
      query.location_shift_id = filters.location_shift_id;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.start_date || filters.end_date) {
      query.$and = [];
      if (filters.start_date) {
        const parsedStart = new Date(filters.start_date);
        parsedStart.setHours(0, 0, 0, 0);
        query.$and.push({ end_date: { $gte: parsedStart } });
      }
      if (filters.end_date) {
        const parsedEnd = new Date(filters.end_date);
        parsedEnd.setHours(23, 59, 59, 999);
        query.$and.push({ start_date: { $lte: parsedEnd } });
      }
    }

    return StaffShiftAssignment.find(query).sort({ start_date: 1, created_at: -1 });
  }

  async getAssignmentById(id) {
    const assignment = await StaffShiftAssignment.findOne({ id });

    if (!assignment) {
      const error = new Error("Assignment not found");
      error.statusCode = 404;
      throw error;
    }

    return assignment;
  }

  async updateAssignment(id, data) {
    const assignment = await this.getAssignmentById(id);

    let startDate = assignment.start_date;
    let endDate = assignment.end_date;

    // If date range changes, validate and recalculate times
    if (data.start_date || data.end_date) {
      const newStart = data.start_date ? new Date(data.start_date) : assignment.start_date;
      const newEnd = data.end_date ? new Date(data.end_date) : assignment.end_date;

      newStart.setHours(0, 0, 0, 0);
      newEnd.setHours(23, 59, 59, 999);

      if (newStart > newEnd) {
        const error = new Error("start_date must be less than or equal to end_date");
        error.statusCode = 400;
        throw error;
      }

      // Check for duplicate with new date range
      if (data.start_date || data.end_date) {
        const existingOther = await StaffShiftAssignment.findOne({
          id: { $ne: id },
          staff_id: assignment.staff_id,
          location_shift_id: assignment.location_shift_id,
          start_date: newStart,
          end_date: newEnd,
        }).lean();

        if (existingOther) {
          const error = new Error("Assignment already exists for this date range");
          error.statusCode = 409;
          throw error;
        }
      }

      startDate = newStart;
      endDate = newEnd;

      // Recalculate times based on shift
      const locationShift = await LocationShift.findOne({ id: assignment.location_shift_id }).lean();
      const shift = await StaffShift.findOne({ id: locationShift.shift_id }).lean();

      assignment.checkin_at = this.buildDateTimeFromDateAndClock(startDate, shift.start_time);
      assignment.checkout_at = this.buildDateTimeFromDateAndClock(endDate, shift.end_time);
      assignment.start_date = startDate;
      assignment.end_date = endDate;
    }

    if (data.status !== undefined) {
      const validStatuses = ["ASSIGNED", "CHECKED_IN", "COMPLETED", "ABSENT"];
      if (!validStatuses.includes(data.status)) {
        const error = new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
        error.statusCode = 400;
        throw error;
      }
      assignment.status = data.status;
    }

    await assignment.save();
    return assignment;
  }

  async deleteAssignment(id) {
    const assignment = await this.getAssignmentById(id);
    await StaffShiftAssignment.deleteOne({ id });
    return assignment;
  }



  async findUserById(staffId) {
    const userQuery = { $or: [{ id: staffId }] };
    if (mongoose.Types.ObjectId.isValid(staffId)) {
      userQuery.$or.push({ _id: new mongoose.Types.ObjectId(staffId) });
    }

    return User.findOne(userQuery).select("_id id role name email");
  }

  async checkinWork({ shift_assignment_id, user }) {
    if (!shift_assignment_id) {
      const error = new Error("shift_assignment_id is required");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id });
    if (!assignment) {
      const error = new Error("Shift assignment not found");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("You are not allowed to check in this assignment");
      error.statusCode = 403;
      throw error;
    }

    if (assignment.status === "ABSENT") {
      const error = new Error(`Cannot check in assignment with status ${assignment.status}`);
      error.statusCode = 400;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    }).select("id").lean();

    if (existingCheckinLog) {
      const error = new Error("You have already checked in");
      error.statusCode = 400;
      throw error;
    }

    await StaffAttendanceLog.create({
      staff_id: assignment.staff_id,
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    });

    return assignment;
  }

  async checkoutWork({ shift_assignment_id, user }) {
    if (!shift_assignment_id) {
      const error = new Error("shift_assignment_id is required");
      error.statusCode = 400;
      throw error;
    }

    const assignment = await StaffShiftAssignment.findOne({ id: shift_assignment_id });
    if (!assignment) {
      const error = new Error("Shift assignment not found");
      error.statusCode = 404;
      throw error;
    }

    const requesterIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    if (!requesterIds.includes(String(assignment.staff_id))) {
      const error = new Error("You are not allowed to check out this assignment");
      error.statusCode = 403;
      throw error;
    }

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    }).select("id").lean();

    if (!existingCheckinLog) {
      const error = new Error("You must check in before check out");
      error.statusCode = 400;
      throw error;
    }

    const existingCheckoutLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
    }).select("id").lean();

    if (existingCheckoutLog) {
      const error = new Error("You have already checked out");
      error.statusCode = 400;
      throw error;
    }

    await StaffAttendanceLog.create({
      staff_id: assignment.staff_id,
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
    });

    return assignment;
  }
}

module.exports = new StaffShiftAssignmentService();
