const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");
const Booking = require("../models/Bookings");
const User = require("../models/User");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeStatus = (status) => {
  if (status === undefined || status === null) return status;
  return String(status).trim().toUpperCase();
};

const validateStatus = (status) => {
  const allowed = ["ASSIGNED", "IN_PROGRESS", "DONE"];
  if (status && !allowed.includes(status)) {
    throw createError(`Invalid status. Must be one of: ${allowed.join(", ")}`, 400);
  }
};

exports.createCleaningTask = async (data) => {
  const {
    pod_id,
    booking_id,
    cleaner_id,
    shift_assignment_id,
    start_time,
    end_time,
    status,
  } = data;

  if (!pod_id || !cleaner_id) {
    throw createError("pod_id and cleaner_id are required", 400);
  }

  const normalizedStatus = normalizeStatus(status) || "ASSIGNED";
  validateStatus(normalizedStatus);

  const [pod, booking, cleaner, assignment] = await Promise.all([
    Pod.findOne({ id: pod_id }).select("id").lean(),
    booking_id ? Booking.findOne({ id: booking_id }).select("id").lean() : Promise.resolve(null),
    User.findOne({ $or: [{ id: cleaner_id }, { _id: cleaner_id }] }).select("id _id role isActive").lean(),
    shift_assignment_id
      ? StaffShiftAssignment.findOne({ id: shift_assignment_id }).select("id").lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (booking_id && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (shift_assignment_id && !assignment) throw createError("Shift assignment not found", 404);

  return CleaningTask.create({
    pod_id,
    booking_id: booking_id || null,
    cleaner_id,
    shift_assignment_id: shift_assignment_id || null,
    start_time: start_time || null,
    end_time: end_time || null,
    status: normalizedStatus,
  });
};

exports.getAllCleaningTasks = async (query = {}) => {
  const filter = {};

  if (query.pod_id) filter.pod_id = query.pod_id;
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.cleaner_id) filter.cleaner_id = query.cleaner_id;
  if (query.shift_assignment_id) filter.shift_assignment_id = query.shift_assignment_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    validateStatus(normalizedStatus);
    filter.status = normalizedStatus;
  }

  return CleaningTask.find(filter).sort({ created_at: -1 });
};

exports.getMyCleaningTasks = async (user, query = {}) => {
  if (!user) {
    throw createError("User context is required", 401);
  }

  const cleanerIds = [
    user && user.id ? String(user.id) : null,
    user && user._id ? String(user._id) : null,
  ].filter(Boolean);

  if (cleanerIds.length === 0) {
    throw createError("Unable to resolve cleaner id", 400);
  }

  const filter = {
    cleaner_id: { $in: [...new Set(cleanerIds)] },
  };

  if (query.pod_id) filter.pod_id = query.pod_id;
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.shift_assignment_id) filter.shift_assignment_id = query.shift_assignment_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    validateStatus(normalizedStatus);
    filter.status = normalizedStatus;
  }

  return CleaningTask.find(filter).sort({ created_at: -1 });
};

exports.getCleaningTaskById = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);
  return task;
};

exports.updateCleaningTask = async (id, data) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  const nextPodId = data.pod_id !== undefined ? data.pod_id : task.pod_id;
  const nextBookingId = data.booking_id !== undefined ? data.booking_id : task.booking_id;
  const nextCleanerId = data.cleaner_id !== undefined ? data.cleaner_id : task.cleaner_id;
  const nextShiftAssignmentId =
    data.shift_assignment_id !== undefined ? data.shift_assignment_id : task.shift_assignment_id;

  const nextStatus =
    data.status !== undefined ? normalizeStatus(data.status) : task.status;
  validateStatus(nextStatus);

  const [pod, booking, cleaner, assignment] = await Promise.all([
    Pod.findOne({ id: nextPodId }).select("id").lean(),
    nextBookingId ? Booking.findOne({ id: nextBookingId }).select("id").lean() : Promise.resolve(null),
    User.findOne({ $or: [{ id: nextCleanerId }, { _id: nextCleanerId }] }).select("id _id role isActive").lean(),
    nextShiftAssignmentId
      ? StaffShiftAssignment.findOne({ id: nextShiftAssignmentId }).select("id").lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (nextBookingId && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (nextShiftAssignmentId && !assignment) throw createError("Shift assignment not found", 404);

  task.pod_id = nextPodId;
  task.booking_id = nextBookingId || null;
  task.cleaner_id = nextCleanerId;
  task.shift_assignment_id = nextShiftAssignmentId || null;
  task.start_time = data.start_time !== undefined ? data.start_time : task.start_time;
  task.end_time = data.end_time !== undefined ? data.end_time : task.end_time;
  task.status = nextStatus;

  await task.save();
  return task;
};

exports.deleteCleaningTask = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  await CleaningTask.deleteOne({ id });
  return { message: "Cleaning task deleted successfully" };
};
