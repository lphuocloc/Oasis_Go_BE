const LostFoundItem = require("../models/LostFoundItem");
const CleaningTask = require("../models/CleaningTask");
const Pod = require("../models/Pod");

const LOST_FOUND_STATUSES = ["FOUND", "STORED", "CLAIMED", "DISPOSED"];

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeStatus = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const resolveActorIds = (actor) => [actor?.id, actor?._id].filter(Boolean).map((id) => String(id));

const resolveCreateContext = async ({ cleaning_task_id, pod_id, booking_id }, actor) => {
  if (!cleaning_task_id && !pod_id) {
    throw createError("Either cleaning_task_id or pod_id is required", 400);
  }

  if (cleaning_task_id) {
    const task = await CleaningTask.findOne({ id: cleaning_task_id })
      .select("id pod_id booking_id cleaner_id")
      .lean();
    if (!task) throw createError("Cleaning task not found", 404);

    const actorRole = String(actor?.role || "").toLowerCase();
    const actorIds = resolveActorIds(actor);
    const isOwner = actorIds.includes(String(task.cleaner_id));

    if (actorRole === "cleaner" && !isOwner) {
      throw createError("You are not allowed to create lost & found item for this cleaning task", 403);
    }

    return {
      cleaning_task_id: task.id,
      pod_id: task.pod_id,
      booking_id: booking_id || task.booking_id || null,
    };
  }

  const pod = await Pod.findOne({ id: pod_id }).select("id").lean();
  if (!pod) throw createError("Pod not found", 404);

  return {
    cleaning_task_id: null,
    pod_id,
    booking_id: booking_id || null,
  };
};

exports.createLostFoundItem = async ({ cleaning_task_id, pod_id, booking_id, item_name, description, found_at }, actor) => {
  const context = await resolveCreateContext({ cleaning_task_id, pod_id, booking_id }, actor);

  const normalizedItemName = String(item_name || "").trim();
  if (!normalizedItemName) throw createError("item_name is required", 400);
  const actorIds = resolveActorIds(actor);
  if (!actorIds[0]) throw createError("Unable to resolve finder identity", 401);

  const item = await LostFoundItem.create({
    cleaning_task_id: context.cleaning_task_id,
    pod_id: context.pod_id,
    booking_id: context.booking_id,
    found_by_user_id: actorIds[0],
    item_name: normalizedItemName,
    description: description ? String(description).trim() : null,
    found_at: found_at ? new Date(found_at) : new Date(),
    status: "FOUND",
  });

  return item;
};

exports.getLostFoundItems = async (query = {}) => {
  const filter = {};

  if (query.cleaning_task_id) filter.cleaning_task_id = query.cleaning_task_id;
  if (query.pod_id) filter.pod_id = query.pod_id;
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.found_by_user_id) filter.found_by_user_id = query.found_by_user_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    if (!LOST_FOUND_STATUSES.includes(normalizedStatus)) {
      throw createError(`Invalid status. Must be one of: ${LOST_FOUND_STATUSES.join(", ")}`, 400);
    }
    filter.status = normalizedStatus;
  }

  return LostFoundItem.find(filter).sort({ created_at: -1 });
};

exports.getLostFoundItemById = async (id) => {
  const item = await LostFoundItem.findOne({ id });
  if (!item) throw createError("Lost & found item not found", 404);
  return item;
};

exports.updateLostFoundStatus = async (id, status, actor) => {
  const normalizedStatus = normalizeStatus(status);
  if (!LOST_FOUND_STATUSES.includes(normalizedStatus)) {
    throw createError(`Invalid status. Must be one of: ${LOST_FOUND_STATUSES.join(", ")}`, 400);
  }

  const item = await LostFoundItem.findOne({ id });
  if (!item) throw createError("Lost & found item not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = resolveActorIds(actor);
  const isFinder = actorIds.includes(String(item.found_by_user_id));

  if (actorRole === "cleaner" && !isFinder) {
    throw createError("You are not allowed to update this lost & found item", 403);
  }

  item.status = normalizedStatus;

  if (normalizedStatus === "CLAIMED") {
    item.claimed_by_user_id = item.claimed_by_user_id || null;
    item.claimed_at = new Date();
  }

  await item.save();
  return item;
};
