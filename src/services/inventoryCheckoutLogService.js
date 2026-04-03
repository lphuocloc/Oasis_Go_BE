const mongoose = require("mongoose");
const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");
const InventoryStock = require("../models/InventoryStock");
const CleaningTask = require("../models/CleaningTask");
const MaintenanceTask = require("../models/MaintenanceTask");
const User = require("../models/User");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const getUserIdentity = (user) => {
  if (!user) return null;
  if (user.id !== undefined && user.id !== null && String(user.id).trim() !== "") return String(user.id);
  if (user._id !== undefined && user._id !== null && String(user._id).trim() !== "") return String(user._id);
  return null;
};

const buildUserIdentityQuery = (identity) => {
  const normalizedIdentity = String(identity || "").trim();
  if (!normalizedIdentity) {
    return null;
  }

  const orQuery = [{ id: normalizedIdentity }];
  if (mongoose.Types.ObjectId.isValid(normalizedIdentity)) {
    orQuery.push({ _id: new mongoose.Types.ObjectId(normalizedIdentity) });
  }

  return { $or: orQuery };
};

const findStaffUser = async (staffId) => {
  if (!staffId) return null;

  const query = buildUserIdentityQuery(staffId);
  if (!query) return null;

  return User.findOne(query).select("_id id role isActive").lean();
};

const normalizeTaskId = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeActionType = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const normalizeQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw createError("quantity must be a positive integer", 400);
  }
  return quantity;
};

const getStockDelta = (actionType, quantity) => {
  if (actionType === "RETURN") return quantity;
  if (actionType === "CHECKOUT" || actionType === "WASTE") return -quantity;
  if (actionType === "INITIAL" || actionType === "ADJUSTMENT") return 0;
  throw createError("Invalid action_type", 400);
};

const validateLogBusinessRules = ({ actionType, reason, cleaningTaskId, maintenanceTaskId }) => {
  if (!actionType) {
    throw createError("action_type is required", 400);
  }

  const isAdminAction = actionType === "INITIAL" || actionType === "ADJUSTMENT";
  const hasCleaningTask = Boolean(cleaningTaskId);
  const hasMaintenanceTask = Boolean(maintenanceTaskId);

  if (!isAdminAction) {
    if (!hasCleaningTask && !hasMaintenanceTask) {
      throw createError("Either cleaning_task_id or maintenance_task_id is required", 400);
    }

    if (hasCleaningTask && hasMaintenanceTask) {
      throw createError("Only one of cleaning_task_id or maintenance_task_id can be provided", 400);
    }
  }

  if (actionType === "WASTE") {
    const normalizedReason = reason === undefined || reason === null ? "" : String(reason).trim();
    if (!normalizedReason) {
      throw createError("reason is required when action_type is WASTE", 400);
    }
  }
};

const validateTaskReference = async (taskId, Model, message) => {
  if (!taskId) return;

  const exists = await Model.findOne({ id: taskId }).select("id").lean();
  if (!exists) {
    throw createError(message, 404);
  }
};

const resolveCheckoutParticipants = ({ actor, staffId }) => {
  const actorId = getUserIdentity(actor);
  const actorRole = String(actor?.role || "").toLowerCase();
  const requestedStaffId = String(staffId || "").trim();
  const effectiveStaffId = requestedStaffId || actorId;

  if (!effectiveStaffId) {
    throw createError("staff_id is required", 400);
  }

  if (actorId && actorRole === "cleaner" && effectiveStaffId !== actorId) {
    throw createError("Cleaners can only create inventory logs for themselves", 403);
  }

  return {
    actor_id: actorId,
    staff_id: effectiveStaffId,
  };
};

const applyStockDelta = async (stockId, delta, session) => {
  const existingStock = await InventoryStock.findOne({ id: stockId })
    .select("id quantity_available")
    .session(session)
    .lean();

  if (!existingStock) {
    throw createError("Inventory stock not found", 404);
  }

  const normalizedDelta = Number(delta);
  if (normalizedDelta === 0) {
    return existingStock;
  }

  const updateFilter = { id: stockId };
  if (normalizedDelta < 0) {
    updateFilter.quantity_available = { $gte: Math.abs(normalizedDelta) };
  }

  const updatedStock = await InventoryStock.findOneAndUpdate(
    updateFilter,
    {
      $inc: { quantity_available: normalizedDelta },
      $set: { updated_at: new Date() },
    },
    {
      new: true,
      session,
    }
  );

  if (!updatedStock) {
    throw createError(
      normalizedDelta < 0 ? "Insufficient stock for this operation" : "Inventory stock not found",
      normalizedDelta < 0 ? 409 : 404
    );
  }

  return updatedStock;
};

exports.createInventoryCheckoutLog = async (data, actor = null) => {
  const {
    inventory_stock_id,
    staff_id,
    actor_id,
    cleaning_task_id,
    maintenance_task_id,
    quantity,
    action_type,
    reason,
  } = data;

  if (!inventory_stock_id || !staff_id) {
    throw createError("inventory_stock_id and staff_id are required", 400);
  }

  const normalizedActionType = normalizeActionType(action_type);
  const normalizedCleaningTaskId = normalizeTaskId(cleaning_task_id);
  const normalizedMaintenanceTaskId = normalizeTaskId(maintenance_task_id);
  const normalizedReason = reason === undefined || reason === null ? null : String(reason).trim();

  validateLogBusinessRules({
    actionType: normalizedActionType,
    reason: normalizedReason,
    cleaningTaskId: normalizedCleaningTaskId,
    maintenanceTaskId: normalizedMaintenanceTaskId,
  });

  const normalizedQuantity = normalizeQuantity(quantity);
  const effectiveActor = actor || (actor_id ? { id: actor_id } : null);
  const resolvedParticipants = resolveCheckoutParticipants({ actor: effectiveActor, staffId: staff_id });

  const [stock, staff] = await Promise.all([
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available").lean(),
    findStaffUser(resolvedParticipants.staff_id),
    validateTaskReference(normalizedCleaningTaskId, CleaningTask, "Cleaning task not found"),
    validateTaskReference(normalizedMaintenanceTaskId, MaintenanceTask, "Maintenance task not found"),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  const delta = getStockDelta(normalizedActionType, normalizedQuantity);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await applyStockDelta(inventory_stock_id, delta, session);

    const [createdLog] = await InventoryCheckoutLog.create(
      [
        {
          inventory_stock_id,
          staff_id: resolvedParticipants.staff_id,
          actor_id: resolvedParticipants.actor_id,
          cleaning_task_id: normalizedCleaningTaskId,
          maintenance_task_id: normalizedMaintenanceTaskId,
          quantity: normalizedQuantity,
          action_type: normalizedActionType,
          reason: normalizedReason,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return createdLog;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

exports.getAllInventoryCheckoutLogs = async (query = {}) => {
  const filter = {};
  if (query.inventory_stock_id) filter.inventory_stock_id = query.inventory_stock_id;
  if (query.staff_id) filter.staff_id = query.staff_id;
  if (query.action_type) filter.action_type = query.action_type;

  if (query.from || query.to) {
    filter.created_at = {};
    if (query.from) filter.created_at.$gte = new Date(query.from);
    if (query.to) filter.created_at.$lte = new Date(query.to);
  }

  return InventoryCheckoutLog.find(filter).sort({ created_at: -1 });
};

exports.getInventoryCheckoutLogById = async (id) => {
  const log = await InventoryCheckoutLog.findOne({ id });
  if (!log) throw createError("Inventory checkout log not found", 404);
  return log;
};

exports.updateInventoryCheckoutLog = async (id, data, actor = null) => {
  const log = await InventoryCheckoutLog.findOne({ id });
  if (!log) throw createError("Inventory checkout log not found", 404);

  const nextInventoryStockId = data.inventory_stock_id !== undefined ? data.inventory_stock_id : log.inventory_stock_id;
  const nextStaffId = data.staff_id !== undefined ? data.staff_id : log.staff_id;
  const nextActionType =
    data.action_type !== undefined ? normalizeActionType(data.action_type) : normalizeActionType(log.action_type);
  const nextQuantity = data.quantity !== undefined ? normalizeQuantity(data.quantity) : log.quantity;
  const nextCleaningTaskId =
    data.cleaning_task_id !== undefined ? normalizeTaskId(data.cleaning_task_id) : normalizeTaskId(log.cleaning_task_id);
  const nextMaintenanceTaskId =
    data.maintenance_task_id !== undefined
      ? normalizeTaskId(data.maintenance_task_id)
      : normalizeTaskId(log.maintenance_task_id);
  const nextReason =
    data.reason !== undefined
      ? data.reason === null
        ? null
        : String(data.reason).trim()
      : log.reason === null || log.reason === undefined
        ? null
        : String(log.reason).trim();

  validateLogBusinessRules({
    actionType: nextActionType,
    reason: nextReason,
    cleaningTaskId: nextCleaningTaskId,
    maintenanceTaskId: nextMaintenanceTaskId,
  });

  const effectiveActor = actor || (data.actor_id ? { id: data.actor_id } : null);
  const resolvedParticipants = resolveCheckoutParticipants({ actor: effectiveActor, staffId: nextStaffId });

  const [nextStock, nextStaff] = await Promise.all([
    InventoryStock.findOne({ id: nextInventoryStockId }).select("id quantity_available").lean(),
    findStaffUser(resolvedParticipants.staff_id),
    validateTaskReference(nextCleaningTaskId, CleaningTask, "Cleaning task not found"),
    validateTaskReference(nextMaintenanceTaskId, MaintenanceTask, "Maintenance task not found"),
  ]);

  if (!nextStock) throw createError("Inventory stock not found", 404);
  if (!nextStaff) throw createError("Staff user not found", 404);
  if (!nextStaff.isActive) throw createError("Staff user is inactive", 403);

  const oldDelta = getStockDelta(log.action_type, log.quantity);
  const newDelta = getStockDelta(nextActionType, nextQuantity);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await applyStockDelta(log.inventory_stock_id, -oldDelta, session);
    await applyStockDelta(nextInventoryStockId, newDelta, session);

    log.inventory_stock_id = nextInventoryStockId;
    log.staff_id = resolvedParticipants.staff_id;
    log.actor_id = resolvedParticipants.actor_id;
    log.action_type = nextActionType;
    log.quantity = nextQuantity;
    log.cleaning_task_id = nextCleaningTaskId;
    log.maintenance_task_id = nextMaintenanceTaskId;
    log.reason = nextReason;

    await log.save({ session });
    await session.commitTransaction();
    return log;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

exports.deleteInventoryCheckoutLog = async (id) => {
  const log = await InventoryCheckoutLog.findOne({ id });
  if (!log) throw createError("Inventory checkout log not found", 404);

  const delta = getStockDelta(log.action_type, log.quantity);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await applyStockDelta(log.inventory_stock_id, -delta, session);
    await InventoryCheckoutLog.deleteOne({ id }).session(session);

    await session.commitTransaction();
    return { message: "Inventory checkout log deleted successfully" };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

exports.createAutoLog = async ({ inventory_stock_id, staff_id, actor_id, quantity, action_type, reason }) => {
  if (!inventory_stock_id || !staff_id) {
    throw createError("inventory_stock_id and staff_id are required", 400);
  }

  const normalizedActionType = normalizeActionType(action_type);
  const normalizedQuantity = normalizeQuantity(quantity);
  const normalizedReason = reason === undefined || reason === null ? null : String(reason).trim();
  const resolvedParticipants = resolveCheckoutParticipants({
    actor: actor_id ? { id: actor_id } : null,
    staffId: staff_id,
  });

  const [stock, staff] = await Promise.all([
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available").lean(),
    findStaffUser(resolvedParticipants.staff_id),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  return InventoryCheckoutLog.create({
    inventory_stock_id,
    staff_id: resolvedParticipants.staff_id,
    actor_id: resolvedParticipants.actor_id,
    cleaning_task_id: null,
    maintenance_task_id: null,
    quantity: normalizedQuantity,
    action_type: normalizedActionType,
    reason: normalizedReason,
  });
};
