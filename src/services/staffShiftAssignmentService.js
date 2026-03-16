const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const Location = require("../models/Location");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const User = require("../models/User");
const mongoose = require("mongoose");

class StaffShiftAssignmentService {
  async assignManager({ staff_id, parent_location_id, shift_id, work_date }) {
    if (!staff_id || !parent_location_id || !work_date) {
      const error = new Error("staff_id, parent_location_id and work_date are required");
      error.statusCode = 400;
      throw error;
    }

    const [staff, parentLocation] = await Promise.all([
      this.findUserById(staff_id),
      Location.findOne({ id: parent_location_id }),
    ]);

    if (!staff) {
      const error = new Error("Staff not found");
      error.statusCode = 404;
      throw error;
    }

    if (staff.role !== "manager") {
      const error = new Error("Selected staff must have role manager");
      error.statusCode = 400;
      throw error;
    }

    if (!parentLocation) {
      const error = new Error("Parent location not found");
      error.statusCode = 404;
      throw error;
    }

    const date = new Date(work_date);
    if (Number.isNaN(date.getTime())) {
      const error = new Error("work_date must be a valid date (YYYY-MM-DD)");
      error.statusCode = 400;
      throw error;
    }

    const normalizedWorkDate = new Date(date);
    normalizedWorkDate.setHours(0, 0, 0, 0);

    const locationShiftQuery = {
      location_id: parent_location_id,
    };

    if (shift_id) {
      locationShiftQuery.shift_id = shift_id;
    }

    const scopedLocationShifts = await LocationShift.find(locationShiftQuery).lean();

    if (scopedLocationShifts.length === 0) {
      const error = new Error("No location_shift found for this parent location and condition");
      error.statusCode = 400;
      throw error;
    }

    const shiftIds = [...new Set(scopedLocationShifts.map((item) => item.shift_id))];
    const shifts = await StaffShift.find({ id: { $in: shiftIds } }).lean();
    const shiftMap = new Map(shifts.map((item) => [item.id, item]));

    const nonManagerLocationShiftIds = scopedLocationShifts
      .filter((item) => {
        const shift = shiftMap.get(item.shift_id);
        return !shift || shift.role !== "MANAGER";
      })
      .map((item) => item.id);

    const targetLocationShiftIds = scopedLocationShifts
      .filter((item) => !nonManagerLocationShiftIds.includes(item.id))
      .map((item) => item.id);

    if (targetLocationShiftIds.length === 0) {
      const error = new Error("No valid MANAGER location_shift found in child locations");
      error.statusCode = 400;
      throw error;
    }

    const existingAssignments = await StaffShiftAssignment.find({
      staff_id,
      location_shift_id: { $in: targetLocationShiftIds },
      work_date: normalizedWorkDate,
    }).lean();

    const existingByLocationShift = new Set(existingAssignments.map((item) => item.location_shift_id));

    const assignmentsToCreate = scopedLocationShifts
      .filter((item) => !existingByLocationShift.has(item.id))
      .filter((item) => !nonManagerLocationShiftIds.includes(item.id))
      .map((item) => ({
        staff_id,
        location_shift_id: item.id,
        work_date: normalizedWorkDate,
        status: "ASSIGNED",
      }));

    let createdAssignments = [];
    if (assignmentsToCreate.length > 0) {
      createdAssignments = await StaffShiftAssignment.insertMany(assignmentsToCreate, {
        ordered: false,
      });
    }

    return {
      parent_location_id,
      shift_id: shift_id || null,
      staff_id,
      work_date: normalizedWorkDate,
      total_target_locations: 1,
      total_location_shifts_found: scopedLocationShifts.length,
      assigned_count: createdAssignments.length,
      skipped_existing_count: existingAssignments.length,
      non_manager_location_shift_ids: nonManagerLocationShiftIds,
      assigned_location_shift_ids: createdAssignments.map((item) => item.location_shift_id),
    };
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

    if (assignment.checkout_at) {
      const error = new Error("Shift has already been checked out");
      error.statusCode = 400;
      throw error;
    }

    if (assignment.status === "CHECKED_IN") {
      const error = new Error("You have already checked in");
      error.statusCode = 400;
      throw error;
    }

    if (["COMPLETED", "ABSENT"].includes(assignment.status)) {
      const error = new Error(`Cannot check in assignment with status ${assignment.status}`);
      error.statusCode = 400;
      throw error;
    }

    assignment.checkin_at = new Date();
    assignment.status = "CHECKED_IN";
    await assignment.save();

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

    if (!assignment.checkin_at || assignment.status !== "CHECKED_IN") {
      const error = new Error("You must check in before check out");
      error.statusCode = 400;
      throw error;
    }

    if (assignment.checkout_at) {
      const error = new Error("You have already checked out");
      error.statusCode = 400;
      throw error;
    }

    assignment.checkout_at = new Date();
    assignment.status = "COMPLETED";
    await assignment.save();

    await StaffAttendanceLog.create({
      staff_id: assignment.staff_id,
      shift_assignment_id: assignment.id,
      action: "CHECKOUT",
    });

    return assignment;
  }
}

module.exports = new StaffShiftAssignmentService();
