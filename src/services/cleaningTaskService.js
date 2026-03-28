const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Booking = require("../models/Bookings");
const User = require("../models/User");
const LocationShift = require("../models/LocationShift");
const StaffShift = require("../models/StaffShift");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");

const CLEANING_TASK_STATUSES = [
  "ASSIGNED",
  "NOTIFIED",
  "ACCEPTED",
  "ARRIVED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "MISSED",
];

const REQUEST_SOURCES = ["USER_REQUEST", "AUTO_AFTER_CHECKOUT", "SYSTEM_RETRY"];
const ACTIVE_TASK_STATUSES = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "ARRIVED", "IN_PROGRESS"];

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
  if (status && !CLEANING_TASK_STATUSES.includes(status)) {
    throw createError(`Invalid status. Must be one of: ${CLEANING_TASK_STATUSES.join(", ")}`, 400);
  }
};

const normalizeRequestSource = (source) => {
  if (source === undefined || source === null) return source;
  return String(source).trim().toUpperCase();
};

const validateRequestSource = (source) => {
  if (source && !REQUEST_SOURCES.includes(source)) {
    throw createError(`Invalid request_source. Must be one of: ${REQUEST_SOURCES.join(", ")}`, 400);
  }
};

const getDateRangeForDay = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw createError("Invalid booking date for cleaning task assignment", 400);
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return { startOfDay, endOfDay };
};

const getPreferredTaskTime = (booking) => {
  if (booking && booking.end_time) return booking.end_time;
  if (booking && booking.start_time) return booking.start_time;
  return new Date();
};

const getRequestSourceByTrigger = (trigger = "") => {
  const normalized = String(trigger || "").toUpperCase();

  if (["BOOKING_ORDER_CHECKOUT", "SET_CLEANER_ACCESS_TRUE"].includes(normalized)) {
    return "AUTO_AFTER_CHECKOUT";
  }

  if (normalized.includes("RETRY")) {
    return "SYSTEM_RETRY";
  }

  return "USER_REQUEST";
};

const isDuplicateBookingTaskError = (error) => {
  if (!error || error.code !== 11000) return false;
  if (!error.keyPattern) return false;
  return Boolean(error.keyPattern.booking_id);
};

const applyStatusAuditFields = (taskPayload, previousStatus = null) => {
  const nextStatus = normalizeStatus(taskPayload.status);
  if (!nextStatus || nextStatus === previousStatus) {
    return;
  }

  const now = new Date();

  if (nextStatus === "ASSIGNED" && !taskPayload.assigned_at) {
    taskPayload.assigned_at = now;
  }

  if (nextStatus === "NOTIFIED" && !taskPayload.notified_at) {
    taskPayload.notified_at = now;
  }

  if (nextStatus === "ACCEPTED" && !taskPayload.accepted_at) {
    taskPayload.accepted_at = now;
  }

  if (nextStatus === "IN_PROGRESS" && !taskPayload.start_time) {
    taskPayload.start_time = now;
  }

  if (nextStatus === "DONE" && !taskPayload.end_time) {
    taskPayload.end_time = now;
  }
};

const applyDueRangeFilter = (filter, query = {}) => {
  const dueAtFilter = {};
  if (query.due_from) {
    const dueFrom = new Date(query.due_from);
    if (Number.isNaN(dueFrom.getTime())) {
      throw createError("due_from must be a valid date", 400);
    }
    dueAtFilter.$gte = dueFrom;
  }

  if (query.due_to) {
    const dueTo = new Date(query.due_to);
    if (Number.isNaN(dueTo.getTime())) {
      throw createError("due_to must be a valid date", 400);
    }
    dueAtFilter.$lte = dueTo;
  }

  if (Object.keys(dueAtFilter).length > 0) {
    filter.due_at = dueAtFilter;
  }
};

const selectAssignmentWithLoadBalancing = async (assignments = [], eligibleCleanerIds = []) => {
  if (!Array.isArray(assignments) || assignments.length === 0) return null;
  if (!Array.isArray(eligibleCleanerIds) || eligibleCleanerIds.length === 0) return null;

  const cleanerIdSet = new Set(eligibleCleanerIds.map((id) => String(id)));
  const checkedInAssignments = assignments.filter(
    (item) => item.status === "CHECKED_IN" && cleanerIdSet.has(String(item.staff_id))
  );

  const fallbackAssignments = assignments.filter((item) => cleanerIdSet.has(String(item.staff_id)));
  const candidateAssignments = checkedInAssignments.length > 0 ? checkedInAssignments : fallbackAssignments;

  if (candidateAssignments.length === 0) {
    return null;
  }

  const candidateCleanerIds = [...new Set(candidateAssignments.map((item) => String(item.staff_id)))];

  const counts = await CleaningTask.aggregate([
    {
      $match: {
        cleaner_id: { $in: candidateCleanerIds },
        status: { $in: ACTIVE_TASK_STATUSES },
      },
    },
    {
      $group: {
        _id: "$cleaner_id",
        total: { $sum: 1 },
      },
    },
  ]);

  const countMap = new Map(counts.map((item) => [String(item._id), Number(item.total) || 0]));

  let selected = null;
  let minLoad = Number.MAX_SAFE_INTEGER;

  for (const assignment of candidateAssignments) {
    const cleanerId = String(assignment.staff_id);
    const load = countMap.has(cleanerId) ? countMap.get(cleanerId) : 0;

    if (load < minLoad) {
      minLoad = load;
      selected = assignment;
      continue;
    }

    if (load === minLoad && selected) {
      const currentCheckIn = assignment.checkin_at ? new Date(assignment.checkin_at).getTime() : 0;
      const selectedCheckIn = selected.checkin_at ? new Date(selected.checkin_at).getTime() : 0;
      if (currentCheckIn > selectedCheckIn) {
        selected = assignment;
      }
    }
  }

  return selected;
};

exports.autoAssignTaskForBooking = async (bookingLike, options = {}) => {
  const bookingId = bookingLike && bookingLike.id ? String(bookingLike.id) : null;
  const podId = bookingLike && bookingLike.pod_id ? String(bookingLike.pod_id) : null;

  if (!bookingId || !podId) {
    throw createError("booking id and pod_id are required for auto assignment", 400);
  }

  const bookingCheckinState = bookingLike && bookingLike.checkin_state
    ? String(bookingLike.checkin_state).toUpperCase()
    : null;

  if (bookingCheckinState === "NO_SHOW") {
    return { created: false, reason: "NO_SHOW_BLOCKED", booking_id: bookingId };
  }

  if (!bookingCheckinState) {
    const latestBooking = await Booking.findOne({ id: bookingId }).select("id checkin_state").lean();
    if (latestBooking && String(latestBooking.checkin_state || "").toUpperCase() === "NO_SHOW") {
      return { created: false, reason: "NO_SHOW_BLOCKED", booking_id: bookingId };
    }
  }

  const taskReferenceTime = getPreferredTaskTime(bookingLike);
  const { startOfDay, endOfDay } = getDateRangeForDay(taskReferenceTime);

  const existingTask = await CleaningTask.findOne({ booking_id: bookingId }).select("id cleaner_id").lean();
  if (existingTask) {
    return {
      created: false,
      reason: "ALREADY_EXISTS",
      task: existingTask,
      booking_id: bookingId,
    };
  }

  const pod = await Pod.findOne({ id: podId }).select("id cluster_id").lean();
  if (!pod) {
    return { created: false, reason: "POD_NOT_FOUND", booking_id: bookingId };
  }

  const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id").lean();
  if (!cluster || !cluster.location_id) {
    return { created: false, reason: "LOCATION_NOT_FOUND", booking_id: bookingId };
  }

  const locationShifts = await LocationShift.find({ location_id: cluster.location_id }).select("id shift_id").lean();
  if (locationShifts.length === 0) {
    return { created: false, reason: "NO_LOCATION_SHIFT", booking_id: bookingId };
  }

  const shiftIds = [...new Set(locationShifts.map((item) => item.shift_id).filter(Boolean))];
  if (shiftIds.length === 0) {
    return { created: false, reason: "NO_SHIFT_LINKED", booking_id: bookingId };
  }

  const cleanerShifts = await StaffShift.find({
    id: { $in: shiftIds },
    role: "CLEANER",
    is_active: true,
  })
    .select("id")
    .lean();

  if (cleanerShifts.length === 0) {
    return { created: false, reason: "NO_CLEANER_SHIFT", booking_id: bookingId };
  }

  const cleanerShiftIdSet = new Set(cleanerShifts.map((item) => item.id));
  const cleanerLocationShiftIds = locationShifts
    .filter((item) => cleanerShiftIdSet.has(item.shift_id))
    .map((item) => item.id);

  if (cleanerLocationShiftIds.length === 0) {
    return { created: false, reason: "NO_CLEANER_LOCATION_SHIFT", booking_id: bookingId };
  }

  const assignments = await StaffShiftAssignment.find({
    location_shift_id: { $in: cleanerLocationShiftIds },
    work_date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["CHECKED_IN", "ASSIGNED"] },
  })
    .sort({ created_at: 1 })
    .select("id staff_id status checkin_at")
    .lean();

  if (assignments.length === 0) {
    return { created: false, reason: "NO_ASSIGNMENT_IN_DAY", booking_id: bookingId };
  }

  const staffIds = [...new Set(assignments.map((item) => item.staff_id).filter(Boolean))];
  const availableCleaners = await User.find({
    id: { $in: staffIds },
    role: "cleaner",
    isActive: true,
  })
    .select("id")
    .lean();

  if (availableCleaners.length === 0) {
    return { created: false, reason: "NO_ACTIVE_CLEANER", booking_id: bookingId };
  }

  const selectedAssignment = await selectAssignmentWithLoadBalancing(
    assignments,
    availableCleaners.map((item) => item.id)
  );

  if (!selectedAssignment) {
    return { created: false, reason: "NO_ELIGIBLE_ASSIGNMENT", booking_id: bookingId };
  }

  const trigger = options.trigger || "UNKNOWN";
  const requestSource = getRequestSourceByTrigger(trigger);
  const dueAt = bookingLike && bookingLike.end_time ? new Date(bookingLike.end_time) : new Date(taskReferenceTime);

  const payload = {
    pod_id: podId,
    booking_id: bookingId,
    cleaner_id: selectedAssignment.staff_id,
    shift_assignment_id: selectedAssignment.id,
    request_source: requestSource,
    due_at: dueAt,
    assigned_at: new Date(),
    start_time: null,
    end_time: null,
    status: "ASSIGNED",
  };

  applyStatusAuditFields(payload);

  let createdTask;
  try {
    createdTask = await CleaningTask.create(payload);
  } catch (error) {
    if (isDuplicateBookingTaskError(error)) {
      const duplicate = await CleaningTask.findOne({ booking_id: bookingId }).select("id cleaner_id").lean();
      return {
        created: false,
        reason: "ALREADY_EXISTS",
        task: duplicate,
        booking_id: bookingId,
      };
    }

    throw error;
  }

  return {
    created: true,
    reason: "CREATED",
    trigger,
    booking_id: bookingId,
    task: createdTask,
  };
};

exports.createCleaningTask = async (data) => {
  const {
    pod_id,
    booking_id,
    cleaner_id,
    shift_assignment_id,
    request_source,
    due_at,
    assigned_at,
    notified_at,
    accepted_at,
    start_time,
    end_time,
    status,
    note,
    rejection_reason,
    reassigned_from_cleaner_id,
  } = data;

  if (!pod_id || !cleaner_id) {
    throw createError("pod_id and cleaner_id are required", 400);
  }

  const normalizedStatus = normalizeStatus(status) || "ASSIGNED";
  validateStatus(normalizedStatus);
  const normalizedRequestSource = normalizeRequestSource(request_source) || "USER_REQUEST";
  validateRequestSource(normalizedRequestSource);

  const [pod, booking, cleaner, assignment, reassignedCleaner] = await Promise.all([
    Pod.findOne({ id: pod_id }).select("id").lean(),
    booking_id ? Booking.findOne({ id: booking_id }).select("id").lean() : Promise.resolve(null),
    User.findOne({ $or: [{ id: cleaner_id }, { _id: cleaner_id }] }).select("id _id role isActive").lean(),
    shift_assignment_id
      ? StaffShiftAssignment.findOne({ id: shift_assignment_id }).select("id").lean()
      : Promise.resolve(null),
    reassigned_from_cleaner_id
      ? User.findOne({ $or: [{ id: reassigned_from_cleaner_id }, { _id: reassigned_from_cleaner_id }] })
        .select("id _id role")
        .lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (booking_id && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (shift_assignment_id && !assignment) throw createError("Shift assignment not found", 404);
  if (reassigned_from_cleaner_id && !reassignedCleaner) {
    throw createError("reassigned_from_cleaner_id user not found", 404);
  }
  if (reassignedCleaner && reassignedCleaner.role !== "cleaner") {
    throw createError("reassigned_from_cleaner_id must have cleaner role", 400);
  }

  if (booking_id) {
    const existingForBooking = await CleaningTask.findOne({ booking_id }).select("id").lean();
    if (existingForBooking) {
      throw createError("Cleaning task already exists for this booking", 409);
    }
  }

  const payload = {
    pod_id,
    booking_id: booking_id || null,
    cleaner_id,
    shift_assignment_id: shift_assignment_id || null,
    request_source: normalizedRequestSource,
    due_at: due_at || null,
    assigned_at: assigned_at || null,
    notified_at: notified_at || null,
    accepted_at: accepted_at || null,
    start_time: start_time || null,
    end_time: end_time || null,
    status: normalizedStatus,
    note: note || null,
    rejection_reason: rejection_reason || null,
    reassigned_from_cleaner_id: reassigned_from_cleaner_id || null,
  };

  applyStatusAuditFields(payload);

  return CleaningTask.create(payload);
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
  if (query.request_source) {
    const normalizedRequestSource = normalizeRequestSource(query.request_source);
    validateRequestSource(normalizedRequestSource);
    filter.request_source = normalizedRequestSource;
  }

  applyDueRangeFilter(filter, query);

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
  if (query.request_source) {
    const normalizedRequestSource = normalizeRequestSource(query.request_source);
    validateRequestSource(normalizedRequestSource);
    filter.request_source = normalizedRequestSource;
  }

  applyDueRangeFilter(filter, query);

  return CleaningTask.find(filter).sort({ created_at: -1 });
};

exports.getCleaningTaskById = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);
  return task;
};

exports.updateCleaningTask = async (id, data, actor = null) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole === "cleaner") {
    const actorCleanerIds = [
      actor && actor.id ? String(actor.id) : null,
      actor && actor._id ? String(actor._id) : null,
    ].filter(Boolean);

    if (actorCleanerIds.length === 0) {
      throw createError("Unable to resolve cleaner id", 400);
    }

    const isOwner = actorCleanerIds.includes(String(task.cleaner_id));
    if (!isOwner) {
      throw createError("You are not allowed to update this cleaning task", 403);
    }
  }

  const nextPodId = data.pod_id !== undefined ? data.pod_id : task.pod_id;
  const nextBookingId = data.booking_id !== undefined ? data.booking_id : task.booking_id;
  const nextCleanerId = data.cleaner_id !== undefined ? data.cleaner_id : task.cleaner_id;
  const nextShiftAssignmentId =
    data.shift_assignment_id !== undefined ? data.shift_assignment_id : task.shift_assignment_id;

  const nextStatus = data.status !== undefined ? normalizeStatus(data.status) : task.status;
  validateStatus(nextStatus);
  const nextRequestSource =
    data.request_source !== undefined ? normalizeRequestSource(data.request_source) : task.request_source;
  validateRequestSource(nextRequestSource);

  const nextReassignedFromCleanerId =
    data.reassigned_from_cleaner_id !== undefined
      ? data.reassigned_from_cleaner_id
      : task.reassigned_from_cleaner_id;

  const [pod, booking, cleaner, assignment, reassignedCleaner] = await Promise.all([
    Pod.findOne({ id: nextPodId }).select("id").lean(),
    nextBookingId ? Booking.findOne({ id: nextBookingId }).select("id").lean() : Promise.resolve(null),
    User.findOne({ $or: [{ id: nextCleanerId }, { _id: nextCleanerId }] }).select("id _id role isActive").lean(),
    nextShiftAssignmentId
      ? StaffShiftAssignment.findOne({ id: nextShiftAssignmentId }).select("id").lean()
      : Promise.resolve(null),
    nextReassignedFromCleanerId
      ? User.findOne({ $or: [{ id: nextReassignedFromCleanerId }, { _id: nextReassignedFromCleanerId }] })
        .select("id _id role")
        .lean()
      : Promise.resolve(null),
  ]);

  if (!pod) throw createError("Pod not found", 404);
  if (nextBookingId && !booking) throw createError("Booking not found", 404);
  if (!cleaner) throw createError("Cleaner not found", 404);
  if (!cleaner.isActive) throw createError("Cleaner is inactive", 403);
  if (cleaner.role !== "cleaner") throw createError("User must have cleaner role", 400);
  if (nextShiftAssignmentId && !assignment) throw createError("Shift assignment not found", 404);
  if (nextReassignedFromCleanerId && !reassignedCleaner) {
    throw createError("reassigned_from_cleaner_id user not found", 404);
  }
  if (reassignedCleaner && reassignedCleaner.role !== "cleaner") {
    throw createError("reassigned_from_cleaner_id must have cleaner role", 400);
  }

  if (nextBookingId) {
    const existingForBooking = await CleaningTask.findOne({
      booking_id: nextBookingId,
      id: { $ne: id },
    })
      .select("id")
      .lean();

    if (existingForBooking) {
      throw createError("Another cleaning task already exists for this booking", 409);
    }
  }

  const previousStatus = task.status;

  task.pod_id = nextPodId;
  task.booking_id = nextBookingId || null;
  const cleanerChanged = String(task.cleaner_id) !== String(nextCleanerId);

  if (cleanerChanged && data.reassigned_from_cleaner_id === undefined) {
    task.reassigned_from_cleaner_id = task.cleaner_id;
  }

  task.cleaner_id = nextCleanerId;
  task.shift_assignment_id = nextShiftAssignmentId || null;
  task.request_source = nextRequestSource;
  task.due_at = data.due_at !== undefined ? data.due_at : task.due_at;
  task.assigned_at = data.assigned_at !== undefined ? data.assigned_at : task.assigned_at;
  task.notified_at = data.notified_at !== undefined ? data.notified_at : task.notified_at;
  task.accepted_at = data.accepted_at !== undefined ? data.accepted_at : task.accepted_at;
  task.start_time = data.start_time !== undefined ? data.start_time : task.start_time;
  task.end_time = data.end_time !== undefined ? data.end_time : task.end_time;
  task.status = nextStatus;
  task.note = data.note !== undefined ? data.note : task.note;
  task.rejection_reason =
    data.rejection_reason !== undefined ? data.rejection_reason : task.rejection_reason;
  if (data.reassigned_from_cleaner_id !== undefined) {
    task.reassigned_from_cleaner_id = data.reassigned_from_cleaner_id;
  }

  applyStatusAuditFields(task, previousStatus);

  await task.save();
  return task;
};

exports.deleteCleaningTask = async (id) => {
  const task = await CleaningTask.findOne({ id });
  if (!task) throw createError("Cleaning task not found", 404);

  await CleaningTask.deleteOne({ id });
  return { message: "Cleaning task deleted successfully" };
};

exports.backfillMissingCleaningTasks = async (options = {}) => {
  const dryRun =
    options.dry_run === true ||
    String(options.dry_run || "").toLowerCase() === "true";

  const cleanerAccessOnly =
    options.cleaner_access_only === undefined
      ? true
      : options.cleaner_access_only === true || String(options.cleaner_access_only).toLowerCase() === "true";

  const limitRaw = Number(options.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, limitRaw)) : 200;

  const fromDate = options.from_date ? new Date(options.from_date) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    throw createError("from_date must be a valid date", 400);
  }

  const toDate = options.to_date ? new Date(options.to_date) : null;
  if (toDate && Number.isNaN(toDate.getTime())) {
    throw createError("to_date must be a valid date", 400);
  }

  const bookingQuery = {
    status: { $nin: ["CANCELLED"] },
    checkin_state: { $ne: "NO_SHOW" },
  };

  if (cleanerAccessOnly) {
    bookingQuery.cleaner_access_allowed = true;
  }

  if (fromDate || toDate) {
    bookingQuery.end_time = {};
    if (fromDate) bookingQuery.end_time.$gte = fromDate;
    if (toDate) bookingQuery.end_time.$lte = toDate;
  }

  const bookings = await Booking.find(bookingQuery)
    .sort({ end_time: 1 })
    .limit(limit)
    .select("id pod_id start_time end_time cleaner_access_allowed status")
    .lean();

  const summary = {
    dry_run: dryRun,
    cleaner_access_only: cleanerAccessOnly,
    scanned: bookings.length,
    created_count: 0,
    skipped_count: 0,
    failed_count: 0,
    created_booking_ids: [],
    skipped: [],
    failed: [],
  };

  for (const booking of bookings) {
    const existing = await CleaningTask.findOne({ booking_id: booking.id }).select("id").lean();
    if (existing) {
      summary.skipped_count += 1;
      summary.skipped.push({ booking_id: booking.id, reason: "ALREADY_EXISTS" });
      continue;
    }

    if (dryRun) {
      summary.created_count += 1;
      summary.created_booking_ids.push(booking.id);
      continue;
    }

    try {
      const result = await exports.autoAssignTaskForBooking(booking, { trigger: "SYSTEM_RETRY_BACKFILL" });
      if (result && result.created) {
        summary.created_count += 1;
        summary.created_booking_ids.push(booking.id);
      } else {
        summary.skipped_count += 1;
        summary.skipped.push({ booking_id: booking.id, reason: result?.reason || "SKIPPED" });
      }
    } catch (error) {
      summary.failed_count += 1;
      summary.failed.push({
        booking_id: booking.id,
        reason: error.message || "UNKNOWN_ERROR",
      });
    }
  }

  return summary;
};

exports.startBackfillJob = (intervalMinutes = 60, defaultOptions = {}) => {
  const safeIntervalMinutes = Math.max(5, Number(intervalMinutes) || 60);

  console.log(`Starting cleaning task backfill job (interval: ${safeIntervalMinutes} minute(s))`);

  const runBackfill = async () => {
    try {
      const result = await exports.backfillMissingCleaningTasks(defaultOptions);
      console.log(
        `Cleaning task backfill job result: scanned=${result.scanned}, created=${result.created_count}, skipped=${result.skipped_count}, failed=${result.failed_count}`
      );
    } catch (error) {
      console.error("Cleaning task backfill job error:", error);
    }
  };

  runBackfill().catch(() => null);
  setInterval(runBackfill, safeIntervalMinutes * 60 * 1000);
};
