const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const StaffAttendanceLog = require("../models/StaffAttendanceLog");
const Location = require("../models/Location");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const User = require("../models/User");
const mongoose = require("mongoose");

class StaffShiftAssignmentService {
  getStartOfWeek(weekStartDateInput) {
    if (!weekStartDateInput) {
      const error = new Error("week_start_date is required");
      error.statusCode = 400;
      throw error;
    }

    const parsed = new Date(weekStartDateInput);
    if (Number.isNaN(parsed.getTime())) {
      const error = new Error("week_start_date must be a valid date (YYYY-MM-DD)");
      error.statusCode = 400;
      throw error;
    }

    const startOfWeek = new Date(parsed);
    startOfWeek.setHours(0, 0, 0, 0);
    if (startOfWeek.getDay() !== 0) {
      const error = new Error("week_start_date must be Sunday (day 0)");
      error.statusCode = 400;
      throw error;
    }

    return startOfWeek;
  }

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

    const startOfWeek = new Date(normalizedWorkDate);
    startOfWeek.setDate(normalizedWorkDate.getDate() - normalizedWorkDate.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

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

    const rosters = await StaffWorkRoster.find({
      staff_id,
      location_shift_id: { $in: targetLocationShiftIds },
      is_active: true,
    })
      .sort({ day_of_week: 1, created_at: 1 })
      .lean();

    if (rosters.length === 0) {
      const error = new Error("No active roster found for this manager in selected location/shift scope");
      error.statusCode = 400;
      throw error;
    }

    const scopedById = new Map(scopedLocationShifts.map((item) => [item.id, item]));
    const assignmentsToCreate = rosters
      .map((roster) => {
        const scopedLocationShift = scopedById.get(roster.location_shift_id);
        if (!scopedLocationShift) {
          return null;
        }

        const workDate = new Date(startOfWeek);
        workDate.setDate(startOfWeek.getDate() + Number(roster.day_of_week));
        workDate.setHours(0, 0, 0, 0);

        return {
          staff_id,
          location_shift_id: roster.location_shift_id,
          work_date: workDate,
          status: "ASSIGNED",
        };
      })
      .filter(Boolean);

    if (assignmentsToCreate.length === 0) {
      const error = new Error("No valid roster entries found in selected location/shift scope");
      error.statusCode = 400;
      throw error;
    }

    const existingAssignments = await StaffShiftAssignment.find({
      $or: assignmentsToCreate.map((assignment) => ({
        staff_id: assignment.staff_id,
        location_shift_id: assignment.location_shift_id,
        work_date: assignment.work_date,
      })),
    })
      .select("staff_id location_shift_id work_date")
      .lean();

    const existingKeys = new Set(
      existingAssignments.map(
        (item) => `${item.staff_id}|${item.location_shift_id}|${new Date(item.work_date).toISOString()}`
      )
    );

    const dedupedAssignments = [];
    const seenKeys = new Set();
    assignmentsToCreate.forEach((assignment) => {
      const key =
        `${assignment.staff_id}|${assignment.location_shift_id}|${assignment.work_date.toISOString()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        dedupedAssignments.push(assignment);
      }
    });

    const newAssignments = dedupedAssignments.filter((assignment) => {
      const key = `${assignment.staff_id}|${assignment.location_shift_id}|${assignment.work_date.toISOString()}`;
      return !existingKeys.has(key);
    });

    let createdAssignments = [];
    if (newAssignments.length > 0) {
      createdAssignments = await StaffShiftAssignment.insertMany(newAssignments, {
        ordered: false,
      });
    }

    return {
      parent_location_id,
      shift_id: shift_id || null,
      staff_id,
      week_start_date: startOfWeek,
      total_target_locations: 1,
      total_location_shifts_found: scopedLocationShifts.length,
      roster_count: rosters.length,
      assigned_count: createdAssignments.length,
      skipped_existing_count: dedupedAssignments.length - createdAssignments.length,
      non_manager_location_shift_ids: nonManagerLocationShiftIds,
      assigned_location_shift_ids: createdAssignments.map((item) => item.location_shift_id),
    };
  }

  async generateWeeklyAssignmentsFromRoster({ staff_id, week_start_date }) {
    if (!staff_id) {
      const error = new Error("staff_id is required");
      error.statusCode = 400;
      throw error;
    }

    const staff = await this.findUserById(staff_id);
    if (!staff) {
      const error = new Error("Staff not found");
      error.statusCode = 404;
      throw error;
    }

    const startOfWeek = this.getStartOfWeek(week_start_date);

    const rosters = await StaffWorkRoster.find({ staff_id, is_active: true })
      .sort({ day_of_week: 1, created_at: 1 })
      .lean();

    if (rosters.length === 0) {
      const error = new Error("No active roster found for this staff");
      error.statusCode = 400;
      throw error;
    }

    const rosterLocationShiftIds = [...new Set(rosters.map((item) => item.location_shift_id))];
    const locationShifts = await LocationShift.find({ id: { $in: rosterLocationShiftIds } }).lean();
    const locationShiftMap = new Map(locationShifts.map((item) => [item.id, item]));

    const shiftIds = [...new Set(locationShifts.map((item) => item.shift_id))];
    const shifts = await StaffShift.find({ id: { $in: shiftIds } }).lean();
    const shiftMap = new Map(shifts.map((item) => [item.id, item]));

    const assignmentsToCreate = rosters
      .map((roster) => {
        const locationShift = locationShiftMap.get(roster.location_shift_id);
        if (!locationShift) {
          return null;
        }

        const workDate = new Date(startOfWeek);
        workDate.setDate(startOfWeek.getDate() + Number(roster.day_of_week));
        workDate.setHours(0, 0, 0, 0);

        return {
          staff_id,
          location_shift_id: roster.location_shift_id,
          work_date: workDate,
          status: "ASSIGNED",
        };
      })
      .filter(Boolean);

    if (assignmentsToCreate.length === 0) {
      const error = new Error("No valid location_shift found from roster");
      error.statusCode = 400;
      throw error;
    }

    const existingAssignments = await StaffShiftAssignment.find({
      $or: assignmentsToCreate.map((assignment) => ({
        staff_id: assignment.staff_id,
        location_shift_id: assignment.location_shift_id,
        work_date: assignment.work_date,
      })),
    })
      .select("staff_id location_shift_id work_date")
      .lean();

    const existingKeys = new Set(
      existingAssignments.map(
        (item) => `${item.staff_id}|${item.location_shift_id}|${new Date(item.work_date).toISOString()}`
      )
    );

    const dedupedAssignments = [];
    const seenKeys = new Set();
    assignmentsToCreate.forEach((assignment) => {
      const key =
        `${assignment.staff_id}|${assignment.location_shift_id}|${assignment.work_date.toISOString()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        dedupedAssignments.push(assignment);
      }
    });

    const newAssignments = dedupedAssignments.filter((assignment) => {
      const key = `${assignment.staff_id}|${assignment.location_shift_id}|${assignment.work_date.toISOString()}`;
      return !existingKeys.has(key);
    });

    let createdAssignments = [];
    if (newAssignments.length > 0) {
      createdAssignments = await StaffShiftAssignment.insertMany(newAssignments, { ordered: false });
    }

    const createdWithShiftTime = createdAssignments.map((assignment) => {
      const locationShift = locationShiftMap.get(assignment.location_shift_id) || null;
      const shift = locationShift ? shiftMap.get(locationShift.shift_id) || null : null;

      return {
        id: assignment.id,
        staff_id: assignment.staff_id,
        location_shift_id: assignment.location_shift_id,
        work_date: assignment.work_date,
        status: assignment.status,
        shift_start_time: shift ? shift.start_time : null,
        shift_end_time: shift ? shift.end_time : null,
      };
    });

    return {
      staff_id,
      week_start_date: startOfWeek,
      roster_count: rosters.length,
      created_count: createdAssignments.length,
      skipped_existing_count: dedupedAssignments.length - createdAssignments.length,
      assignments: createdWithShiftTime,
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

    const existingCheckinLog = await StaffAttendanceLog.findOne({
      shift_assignment_id: assignment.id,
      action: "CHECKIN",
    }).select("id").lean();

    if (existingCheckinLog) {
      const error = new Error("You have already checked in");
      error.statusCode = 400;
      throw error;
    }

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

    if (assignment.status !== "CHECKED_IN") {
      const error = new Error("You must check in before check out");
      error.statusCode = 400;
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
