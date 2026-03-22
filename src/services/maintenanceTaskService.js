const MaintenanceTask = require("../models/MaintenanceTask");
const Pod = require("../models/Pod");
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
  const allowed = ["PENDING", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  if (status && !allowed.includes(status)) {
    throw createError(`Invalid status. Must be one of: ${allowed.join(", ")}`, 400);
  }
};

exports.createMaintenanceTask = async (data) => {
  const { pod_id, reported_by, shift_assignment_id, description, status } = data;

  if (!pod_id || !reported_by) {
    throw createError("pod_id and reported_by are required", 400);
  }

  const normalizedStatus = normalizeStatus(status) || "PENDING";
  validateStatus(normalizedStatus);

  const [pod, reporter, assignment] = await Promise.all([
    Pod.findOne({ id: pod_id }).select("id").lean(),
    User.findOne({ $or: [{ id: reported_by }, { _id: reported_by }] }).select("id _id isActive").lean(),
    shift_assignment_id
      ? StaffShiftAssignment.findOne({ id: shift_assignment_id }).select("id").lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (!reporter) throw createError("Reporter not found", 404);
  if (!reporter.isActive) throw createError("Reporter is inactive", 403);
  if (shift_assignment_id && !assignment) throw createError("Shift assignment not found", 404);

  return MaintenanceTask.create({
    pod_id,
    reported_by,
    shift_assignment_id: shift_assignment_id || null,
    description: description || null,
    status: normalizedStatus,
  });
};

exports.getAllMaintenanceTasks = async (query = {}) => {
  const filter = {};

  if (query.pod_id) filter.pod_id = query.pod_id;
  if (query.reported_by) filter.reported_by = query.reported_by;
  if (query.shift_assignment_id) filter.shift_assignment_id = query.shift_assignment_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    validateStatus(normalizedStatus);
    filter.status = normalizedStatus;
  }

  return MaintenanceTask.find(filter).sort({ created_at: -1 });
};

exports.getMaintenanceTaskById = async (id) => {
  const task = await MaintenanceTask.findOne({ id });
  if (!task) throw createError("Maintenance task not found", 404);
  return task;
};

exports.updateMaintenanceTask = async (id, data) => {
  const task = await MaintenanceTask.findOne({ id });
  if (!task) throw createError("Maintenance task not found", 404);

  const nextPodId = data.pod_id !== undefined ? data.pod_id : task.pod_id;
  const nextReportedBy = data.reported_by !== undefined ? data.reported_by : task.reported_by;
  const nextShiftAssignmentId =
    data.shift_assignment_id !== undefined ? data.shift_assignment_id : task.shift_assignment_id;
  const nextStatus = data.status !== undefined ? normalizeStatus(data.status) : task.status;
  validateStatus(nextStatus);

  const [pod, reporter, assignment] = await Promise.all([
    Pod.findOne({ id: nextPodId }).select("id").lean(),
    User.findOne({ $or: [{ id: nextReportedBy }, { _id: nextReportedBy }] }).select("id _id isActive").lean(),
    nextShiftAssignmentId
      ? StaffShiftAssignment.findOne({ id: nextShiftAssignmentId }).select("id").lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (!reporter) throw createError("Reporter not found", 404);
  if (!reporter.isActive) throw createError("Reporter is inactive", 403);
  if (nextShiftAssignmentId && !assignment) throw createError("Shift assignment not found", 404);

  task.pod_id = nextPodId;
  task.reported_by = nextReportedBy;
  task.shift_assignment_id = nextShiftAssignmentId || null;
  task.description = data.description !== undefined ? data.description : task.description;
  task.status = nextStatus;

  await task.save();
  return task;
};

exports.deleteMaintenanceTask = async (id) => {
  const task = await MaintenanceTask.findOne({ id });
  if (!task) throw createError("Maintenance task not found", 404);

  await MaintenanceTask.deleteOne({ id });
  return { message: "Maintenance task deleted successfully" };
};
