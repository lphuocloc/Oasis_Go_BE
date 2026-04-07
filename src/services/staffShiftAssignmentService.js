const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const LocationShift = require("../models/LocationShift");
const Location = require("../models/Location");
const StaffShift = require("../models/StaffShift");
const User = require("../models/User");
const mongoose = require("mongoose");
const notificationService = require("./notificationService");

const toDateRangeText = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "khong xac dinh";
  }

  const startText = start.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const endText = end.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (start.toDateString() === end.toDateString()) {
    return startText;
  }

  return `${startText} den ${endText}`;
};

const combineDateAndTime = (dateValue, timeValue) => {
  const date = new Date(dateValue);
  const timeText = String(timeValue || "").trim();

  if (Number.isNaN(date.getTime()) || !timeText) return null;

  const parts = timeText.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;

  const [hours, minutes, seconds] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  date.setHours(hours, minutes, seconds, 0);
  return date;
};

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
        start_time: assignment.start_time,
        end_time: assignment.end_time,
        status: assignment.status,
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

    const shift = await StaffShift.findOne({ id: locationShift.shift_id }).lean();
    if (!shift) {
      const error = new Error("Staff shift not found");
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
        start_time: shift.start_time,
        end_time: shift.end_time,
        status: "ASSIGNED",
      });

      if (String(staff.role || "").toLowerCase() === "cleaner") {
        const location = await Location.findOne({ id: locationShift.location_id }).select("id name").lean();
        const dayText = toDateRangeText(startDate, endDate);

        await notificationService.sendToUser(staff._id, {
          title: "Ban co lich lam viec moi",
          message: `Ban da co lich lam viec moi vao ${dayText} tai cum ${location?.name || "Unknown"}.`,
          type: "SHIFT",
          event_code: "SHIFT_ASSIGNED",
          dedupe_key: `SHIFT_ASSIGNED:${assignment.id}:${String(staff._id)}`,
          data: {
            assignment_id: assignment.id,
            location_shift_id: assignment.location_shift_id,
            location_id: locationShift.location_id,
            location_name: location?.name || null,
            shift_id: shift.id,
            shift_name: shift.shift_name,
            start_date: assignment.start_date,
            end_date: assignment.end_date,
            start_time: assignment.start_time,
            end_time: assignment.end_time,
          },
        });
      }

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

    if (filters.location_shift_ids) {
      query.location_shift_id = { $in: filters.location_shift_ids.split(",") };
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

  async sendShiftStartReminders(options = {}) {
    const leadMinutesRaw = Number(options.lead_minutes || 30);
    const leadMinutes = Number.isFinite(leadMinutesRaw) ? Math.max(30, leadMinutesRaw) : 30;

    const now = new Date();
    const threshold = new Date(now.getTime() + leadMinutes * 60 * 1000);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const assignments = await StaffShiftAssignment.find({
      status: "ASSIGNED",
      start_date: { $lte: endOfDay },
      end_date: { $gte: startOfDay },
    })
      .select("id staff_id location_shift_id start_date end_date start_time end_time")
      .lean();

    if (!assignments || assignments.length === 0) {
      return { scanned: 0, reminded: 0, lead_minutes: leadMinutes };
    }

    const locationShiftIds = [...new Set(assignments.map((item) => String(item.location_shift_id || "")).filter(Boolean))];
    const staffIds = [...new Set(assignments.map((item) => String(item.staff_id || "")).filter(Boolean))];

    const [locationShifts, users, shifts, locations] = await Promise.all([
      LocationShift.find({ id: { $in: locationShiftIds } }).select("id shift_id location_id").lean(),
      User.find({
        isActive: true,
        role: "cleaner",
        $or: [
          { id: { $in: staffIds } },
          { _id: { $in: staffIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } },
        ],
      })
        .select("_id id")
        .lean(),
      StaffShift.find({ is_active: true }).select("id shift_name start_time end_time").lean(),
      Location.find({}).select("id name").lean(),
    ]);

    const locationShiftMap = new Map(locationShifts.map((item) => [String(item.id), item]));
    const shiftMap = new Map(shifts.map((item) => [String(item.id), item]));
    const locationMap = new Map(locations.map((item) => [String(item.id), item]));

    const cleanerByIdentity = new Map();
    users.forEach((item) => {
      cleanerByIdentity.set(String(item._id), item);
      if (item.id) cleanerByIdentity.set(String(item.id), item);
    });

    let reminded = 0;

    for (const assignment of assignments) {
      const cleaner = cleanerByIdentity.get(String(assignment.staff_id || ""));
      if (!cleaner) continue;

      const locationShift = locationShiftMap.get(String(assignment.location_shift_id || ""));
      if (!locationShift) continue;

      const shift = shiftMap.get(String(locationShift.shift_id || ""));
      const location = locationMap.get(String(locationShift.location_id || ""));
      const shiftStart = combineDateAndTime(now, assignment.start_time || shift?.start_time);
      if (!shiftStart) continue;

      if (shiftStart < now || shiftStart > threshold) {
        continue;
      }

      await notificationService.sendToUser(cleaner._id, {
        title: `Nhac gio vao ca ${shift?.shift_name || ""}`,
        message: `Ca lam viec ${shift?.shift_name || ""} cua ban bat dau sau 30 phut. Dung quen Check-in!`,
        type: "SHIFT",
        event_code: "SHIFT_START_REMINDER",
        dedupe_key: `SHIFT_START_REMINDER:${assignment.id}:${shiftStart.toISOString().slice(0, 16)}`,
        data: {
          assignment_id: assignment.id,
          shift_name: shift?.shift_name || null,
          start_time: assignment.start_time || shift?.start_time || null,
          location_name: location?.name || null,
          reminder_minutes: String(leadMinutes),
        },
      });

      reminded += 1;
    }

    return {
      scanned: assignments.length,
      reminded,
      lead_minutes: leadMinutes,
    };
  }

  startShiftReminderJob(intervalMinutes = 5, leadMinutes = 30) {
    const safeIntervalMinutes = Math.max(1, Number(intervalMinutes) || 5);

    console.log(
      `Starting shift reminder job (interval: ${safeIntervalMinutes} minute(s), lead: ${leadMinutes} minute(s))`
    );

    const runReminders = async () => {
      try {
        const result = await this.sendShiftStartReminders({ lead_minutes: leadMinutes });
        if (result.reminded > 0) {
          console.log(
            `Shift reminder job result: scanned=${result.scanned}, reminded=${result.reminded}, lead=${result.lead_minutes}`
          );
        }
      } catch (error) {
        console.error("Shift reminder job error:", error);
      }
    };

    runReminders().catch(() => null);
    setInterval(runReminders, safeIntervalMinutes * 60 * 1000);
  }



  async findUserById(staffId) {
    const userQuery = { $or: [{ id: staffId }] };
    if (mongoose.Types.ObjectId.isValid(staffId)) {
      userQuery.$or.push({ _id: new mongoose.Types.ObjectId(staffId) });
    }

    return User.findOne(userQuery).select("_id id role name email");
  }
}

module.exports = new StaffShiftAssignmentService();
