const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const LocationShift = require("../models/LocationShift");
const Location = require("../models/Location");
const StaffShift = require("../models/StaffShift");
const User = require("../models/User");
const mongoose = require("mongoose");

class StaffShiftAssignmentService {
  async getMyAssignments({ user, work_date, from_date, to_date, start_date, end_date, status }) {
    if (!user) {
      const error = new Error("User context is required");
      error.statusCode = 401;
      throw error;
    }

    const staffIds = [
      user && user.id ? String(user.id) : null,
      user && user._id ? String(user._id) : null,
    ].filter(Boolean);

    if (staffIds.length === 0) {
      const error = new Error("Unable to resolve user id for shift assignments");
      error.statusCode = 400;
      throw error;
    }

    const assignmentQuery = {
      staff_id: { $in: [...new Set(staffIds)] },
    };

    const singleDate = work_date || start_date;
    if (singleDate && !end_date && !to_date && !from_date) {
      const date = new Date(singleDate);
      if (Number.isNaN(date.getTime())) {
        const error = new Error("work_date/start_date must be a valid date (YYYY-MM-DD)");
        error.statusCode = 400;
        throw error;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      assignmentQuery.$and = [
        { end_date: { $gte: startOfDay } },
        { start_date: { $lte: endOfDay } },
      ];
    } else if (from_date || to_date || start_date || end_date) {
      const rangeStartInput = from_date || start_date;
      const rangeEndInput = to_date || end_date;

      assignmentQuery.$and = [];

      if (rangeStartInput) {
        const fromDate = new Date(rangeStartInput);
        if (Number.isNaN(fromDate.getTime())) {
          const error = new Error("from_date/start_date must be a valid date (YYYY-MM-DD)");
          error.statusCode = 400;
          throw error;
        }
        fromDate.setHours(0, 0, 0, 0);
        assignmentQuery.$and.push({ end_date: { $gte: fromDate } });
      }

      if (rangeEndInput) {
        const toDate = new Date(rangeEndInput);
        if (Number.isNaN(toDate.getTime())) {
          const error = new Error("to_date/end_date must be a valid date (YYYY-MM-DD)");
          error.statusCode = 400;
          throw error;
        }
        toDate.setHours(23, 59, 59, 999);
        assignmentQuery.$and.push({ start_date: { $lte: toDate } });
      }

      if (assignmentQuery.$and.length === 0) {
        delete assignmentQuery.$and;
      }
    }

    if (status) {
      const allowedStatuses = ["ASSIGNED", "COMPLETED", "ABSENT"];
      const statuses = String(status)
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

      const invalidStatuses = statuses.filter((item) => !allowedStatuses.includes(item));
      if (invalidStatuses.length > 0) {
        const error = new Error(
          `Invalid status value: ${invalidStatuses.join(", ")}. Allowed: ${allowedStatuses.join(", ")}`
        );
        error.statusCode = 400;
        throw error;
      }

      if (statuses.length > 0) {
        assignmentQuery.status = { $in: statuses };
      }
    }

    const assignments = await StaffShiftAssignment.find(assignmentQuery)
      .sort({ start_date: 1, created_at: -1 })
      .lean();

    if (assignments.length === 0) {
      return {
        count: 0,
        data: [],
      };
    }

    const locationShiftIds = [...new Set(assignments.map((item) => item.location_shift_id))];
    const locationShifts = await LocationShift.find({ id: { $in: locationShiftIds } }).lean();
    const locationShiftMap = new Map(locationShifts.map((item) => [item.id, item]));

    const shiftIds = [...new Set(locationShifts.map((item) => item.shift_id).filter(Boolean))];
    const locationIds = [...new Set(locationShifts.map((item) => item.location_id).filter(Boolean))];

    const [shifts, locations] = await Promise.all([
      StaffShift.find({ id: { $in: shiftIds } }).lean(),
      Location.find({ id: { $in: locationIds } }).select("id name type parent_id").lean(),
    ]);

    const shiftMap = new Map(shifts.map((item) => [item.id, item]));
    const locationMap = new Map(locations.map((item) => [item.id, item]));

    const data = assignments.map((assignment) => {
      const locationShift = locationShiftMap.get(assignment.location_shift_id) || null;
      const shift = locationShift ? shiftMap.get(locationShift.shift_id) || null : null;
      const location = locationShift ? locationMap.get(locationShift.location_id) || null : null;

      return {
        assignment_id: assignment.id,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        status: assignment.status,
        checkin_at: assignment.checkin_at,
        checkout_at: assignment.checkout_at,
        location_shift_id: assignment.location_shift_id,
        shift,
        location,
      };
    });

    return {
      count: data.length,
      data,
    };
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

      assignment.start_date = startDate;
      assignment.end_date = endDate;
    }

    if (data.status !== undefined) {
      const validStatuses = ["ASSIGNED", "COMPLETED", "ABSENT"];
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

    assignment.checkin_at = new Date();
    await assignment.save();

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

    assignment.checkout_at = new Date();
    assignment.status = "COMPLETED";
    await assignment.save();

    return assignment;
  }
}

module.exports = new StaffShiftAssignmentService();
