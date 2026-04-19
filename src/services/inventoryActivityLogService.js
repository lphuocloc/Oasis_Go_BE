const mongoose = require("mongoose");
const InventoryActivityLog = require("../models/InventoryActivityLog");
const InventoryStock = require("../models/InventoryStock");
const CleaningTask = require("../models/CleaningTask");
const MaintenanceTask = require("../models/MaintenanceTask");
const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const LocationShift = require("../models/LocationShift");
const LocationWarehouse = require("../models/LocationWarehouse");
const PodItem = require("../models/PodItem");
const User = require("../models/User");
const Item = require("../models/Item");
const Warehouse = require("../models/Warehouse");
const notificationService = require("./notificationService");

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

const normalizeShiftAssignmentId = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeCleanerId = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const buildDayRange = (dateValue) => {
  const target = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(target.getTime())) {
    throw createError("Invalid date", 400);
  }

  const dayStart = new Date(target);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(target);
  dayEnd.setHours(23, 59, 59, 999);

  return { dayStart, dayEnd };
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

  const hasCleaningTask = Boolean(cleaningTaskId);
  const hasMaintenanceTask = Boolean(maintenanceTaskId);

  if (hasCleaningTask && hasMaintenanceTask) {
    throw createError("Only one of cleaning_task_id or maintenance_task_id can be provided", 400);
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

const validateShiftAssignmentReference = async (shiftAssignmentId) => {
  if (!shiftAssignmentId) return;

  const exists = await StaffShiftAssignment.findOne({ id: shiftAssignmentId })
    .select("id")
    .lean();
  if (!exists) {
    throw createError("Shift assignment not found", 404);
  }
};

const validateCleanerOwnership = async ({ actor, staffId, shiftAssignmentId, cleaningTaskId, maintenanceTaskId }) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (actorRole !== "cleaner") {
    return;
  }

  const actorId = getUserIdentity(actor);
  if (!actorId) {
    throw createError("Unable to resolve cleaner identity", 401);
  }

  if (String(staffId || "") !== actorId) {
    throw createError("Cleaners can only create inventory logs for themselves", 403);
  }

  if (maintenanceTaskId) {
    throw createError("Cleaner is not allowed to use maintenance_task_id", 403);
  }

  const [assignment, cleaningTask] = await Promise.all([
    shiftAssignmentId
      ? StaffShiftAssignment.findOne({ id: shiftAssignmentId })
        .select("id staff_id")
        .lean()
      : Promise.resolve(null),
    cleaningTaskId
      ? CleaningTask.findOne({ id: cleaningTaskId })
        .select("id cleaner_id shift_assignment_id")
        .lean()
      : Promise.resolve(null),
  ]);

  if (shiftAssignmentId && !assignment) {
    throw createError("Shift assignment not found", 404);
  }

  if (assignment && String(assignment.staff_id || "") !== actorId) {
    throw createError("You are not owner of this shift_assignment_id", 403);
  }

  if (cleaningTaskId && !cleaningTask) {
    throw createError("Cleaning task not found", 404);
  }

  if (cleaningTask && String(cleaningTask.cleaner_id || "") !== actorId) {
    throw createError("You are not owner of this cleaning_task_id", 403);
  }

  if (
    shiftAssignmentId
    && cleaningTask
    && cleaningTask.shift_assignment_id
    && String(cleaningTask.shift_assignment_id) !== String(shiftAssignmentId)
  ) {
    throw createError("cleaning_task_id does not belong to shift_assignment_id", 400);
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

exports.createInventoryActivityLog = async (data, actor = null) => {
  const {
    inventory_stock_id,
    staff_id,
    actor_id,
    shift_assignment_id,
    cleaning_task_id,
    maintenance_task_id,
    quantity,
    action_type,
    reason,
  } = data;

  if (!inventory_stock_id) {
    throw createError("inventory_stock_id is required", 400);
  }

  const normalizedActionType = normalizeActionType(action_type);
  const normalizedShiftAssignmentId = normalizeShiftAssignmentId(shift_assignment_id);
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
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available item_id warehouse_id").lean(),
    findStaffUser(resolvedParticipants.staff_id),
    validateShiftAssignmentReference(normalizedShiftAssignmentId),
    validateTaskReference(normalizedCleaningTaskId, CleaningTask, "Cleaning task not found"),
    validateTaskReference(normalizedMaintenanceTaskId, MaintenanceTask, "Maintenance task not found"),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  await validateCleanerOwnership({
    actor: effectiveActor,
    staffId: resolvedParticipants.staff_id,
    shiftAssignmentId: normalizedShiftAssignmentId,
    cleaningTaskId: normalizedCleaningTaskId,
    maintenanceTaskId: normalizedMaintenanceTaskId,
  });

  const delta = getStockDelta(normalizedActionType, normalizedQuantity);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await applyStockDelta(inventory_stock_id, delta, session);

    const [createdLog] = await InventoryActivityLog.create(
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

    const notifyActionTypes = ["CHECKOUT", "RETURN", "WASTE"];
    if (String(staff.role || "").toLowerCase() === "cleaner" && notifyActionTypes.includes(normalizedActionType)) {
      const [item, warehouse] = await Promise.all([
        Item.findOne({ id: stock.item_id }).select("id name").lean(),
        Warehouse.findOne({ id: stock.warehouse_id }).select("id name").lean(),
      ]);

      const notificationConfig = {
        CHECKOUT: {
          title: "Xac nhan xuat kho",
          message: `Ban da xuat ${normalizedQuantity} ${item?.name || "vat tu"} tu kho ${warehouse?.name || "Unknown"}.`,
          event_code: "INVENTORY_CHECKOUT_CONFIRMED",
        },
        RETURN: {
          title: "Xac nhan hoan kho",
          message: `Ban da tra lai ${normalizedQuantity} ${item?.name || "vat tu"} vao kho ${warehouse?.name || "Unknown"}.`,
          event_code: "INVENTORY_RETURN_CONFIRMED",
        },
        WASTE: {
          title: "Xac nhan bao hong",
          message: `Ban da bao ${normalizedQuantity} ${item?.name || "vat tu"} bi hong/that thoat.`,
          event_code: "INVENTORY_WASTE_CONFIRMED",
        },
      }[normalizedActionType];

      await notificationService.sendToUser(staff._id, {
        title: notificationConfig.title,
        message: notificationConfig.message,
        type: "INVENTORY",
        event_code: notificationConfig.event_code,
        dedupe_key: `${notificationConfig.event_code}:${createdLog.id}:${String(staff._id)}`,
        data: {
          activity_log_id: createdLog.id,
          inventory_stock_id,
          action_type: normalizedActionType,
          quantity: String(normalizedQuantity),
          item_id: stock.item_id || null,
          item_name: item?.name || null,
          warehouse_id: stock.warehouse_id || null,
          warehouse_name: warehouse?.name || null,
        },
      });
    }

    return createdLog;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

exports.createInventoryActivityLogsBulk = async (data, actor = null) => {
  const payload = data || {};
  const logs = Array.isArray(payload.logs) ? payload.logs : [];

  if (logs.length === 0) {
    throw createError("logs must be a non-empty array", 400);
  }

  if (logs.length > 100) {
    throw createError("Maximum 100 logs per request", 400);
  }

  const effectiveActor = actor || (payload.actor_id ? { id: payload.actor_id } : null);
  const resolvedParticipants = resolveCheckoutParticipants({ actor: effectiveActor, staffId: payload.staff_id });
  const staff = await findStaffUser(resolvedParticipants.staff_id);

  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const createdLogs = [];
    const notificationDrafts = [];

    for (let index = 0; index < logs.length; index += 1) {
      const entry = logs[index] || {};
      const logLabel = `logs[${index}]`;

      const inventoryStockId = normalizeTaskId(entry.inventory_stock_id);
      if (!inventoryStockId) {
        throw createError(`${logLabel}.inventory_stock_id is required`, 400);
      }

      const normalizedActionType = normalizeActionType(entry.action_type || "CHECKOUT");
      const normalizedShiftAssignmentId = normalizeShiftAssignmentId(entry.shift_assignment_id);
      const normalizedCleaningTaskId = normalizeTaskId(entry.cleaning_task_id);
      const normalizedMaintenanceTaskId = normalizeTaskId(entry.maintenance_task_id);
      const normalizedQuantity = normalizeQuantity(entry.quantity);
      const normalizedReason = entry.reason === undefined || entry.reason === null ? null : String(entry.reason).trim();

      validateLogBusinessRules({
        actionType: normalizedActionType,
        reason: normalizedReason,
        cleaningTaskId: normalizedCleaningTaskId,
        maintenanceTaskId: normalizedMaintenanceTaskId,
      });

      const stock = await InventoryStock.findOne({ id: inventoryStockId })
        .select("id item_id warehouse_id")
        .session(session)
        .lean();
      if (!stock) {
        throw createError(`${logLabel}: Inventory stock not found`, 404);
      }

      await Promise.all([
        validateShiftAssignmentReference(normalizedShiftAssignmentId),
        validateTaskReference(normalizedCleaningTaskId, CleaningTask, `${logLabel}: Cleaning task not found`),
        validateTaskReference(normalizedMaintenanceTaskId, MaintenanceTask, `${logLabel}: Maintenance task not found`),
      ]);

      await validateCleanerOwnership({
        actor: effectiveActor,
        staffId: resolvedParticipants.staff_id,
        shiftAssignmentId: normalizedShiftAssignmentId,
        cleaningTaskId: normalizedCleaningTaskId,
        maintenanceTaskId: normalizedMaintenanceTaskId,
      });

      const delta = getStockDelta(normalizedActionType, normalizedQuantity);
      await applyStockDelta(inventoryStockId, delta, session);

      const [createdLog] = await InventoryActivityLog.create(
        [
          {
            inventory_stock_id: inventoryStockId,
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

      createdLogs.push(createdLog);
      notificationDrafts.push({
        logId: createdLog.id,
        stock,
        quantity: normalizedQuantity,
        actionType: normalizedActionType,
      });
    }

    await session.commitTransaction();

    const notifyActionTypes = ["CHECKOUT", "RETURN", "WASTE"];
    if (String(staff.role || "").toLowerCase() === "cleaner") {
      for (const draft of notificationDrafts) {
        if (!notifyActionTypes.includes(draft.actionType)) continue;

        const [item, warehouse] = await Promise.all([
          Item.findOne({ id: draft.stock.item_id }).select("id name").lean(),
          Warehouse.findOne({ id: draft.stock.warehouse_id }).select("id name").lean(),
        ]);

        const notificationConfig = {
          CHECKOUT: {
            title: "Xac nhan xuat kho",
            message: `Ban da xuat ${draft.quantity} ${item?.name || "vat tu"} tu kho ${warehouse?.name || "Unknown"}.`,
            event_code: "INVENTORY_CHECKOUT_CONFIRMED",
          },
          RETURN: {
            title: "Xac nhan hoan kho",
            message: `Ban da tra lai ${draft.quantity} ${item?.name || "vat tu"} vao kho ${warehouse?.name || "Unknown"}.`,
            event_code: "INVENTORY_RETURN_CONFIRMED",
          },
          WASTE: {
            title: "Xac nhan bao hong",
            message: `Ban da bao ${draft.quantity} ${item?.name || "vat tu"} bi hong/that thoat.`,
            event_code: "INVENTORY_WASTE_CONFIRMED",
          },
        }[draft.actionType];

        await notificationService.sendToUser(staff._id, {
          title: notificationConfig.title,
          message: notificationConfig.message,
          type: "INVENTORY",
          event_code: notificationConfig.event_code,
          dedupe_key: `${notificationConfig.event_code}:${draft.logId}:${String(staff._id)}`,
          data: {
            activity_log_id: draft.logId,
            inventory_stock_id: draft.stock.id,
            action_type: draft.actionType,
            quantity: String(draft.quantity),
            item_id: draft.stock.item_id || null,
            item_name: item?.name || null,
            warehouse_id: draft.stock.warehouse_id || null,
            warehouse_name: warehouse?.name || null,
          },
        });
      }
    }

    return {
      count: createdLogs.length,
      logs: createdLogs,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

exports.getAllInventoryActivityLogs = async (query = {}) => {
  const filter = {};
  if (query.inventory_stock_id) filter.inventory_stock_id = query.inventory_stock_id;
  if (query.staff_id) filter.staff_id = query.staff_id;
  if (query.action_type) filter.action_type = query.action_type;

  if (query.from || query.to) {
    filter.created_at = {};
    if (query.from) filter.created_at.$gte = new Date(query.from);
    if (query.to) filter.created_at.$lte = new Date(query.to);
  }

  return InventoryActivityLog.find(filter).sort({ created_at: -1 });
};

exports.getInventoryActivityLogById = async (id) => {
  const log = await InventoryActivityLog.findOne({ id });
  if (!log) throw createError("inventory activity log not found", 404);
  return log;
};

exports.updateInventoryActivityLog = async (id, data, actor = null) => {
  const log = await InventoryActivityLog.findOne({ id });
  if (!log) throw createError("inventory activity log not found", 404);

  const nextInventoryStockId = data.inventory_stock_id !== undefined ? data.inventory_stock_id : log.inventory_stock_id;
  const nextStaffId = data.staff_id !== undefined ? data.staff_id : log.staff_id;
  const nextActionType =
    data.action_type !== undefined ? normalizeActionType(data.action_type) : normalizeActionType(log.action_type);
  const nextQuantity = data.quantity !== undefined ? normalizeQuantity(data.quantity) : log.quantity;
  const nextShiftAssignmentId =
    data.shift_assignment_id !== undefined ? normalizeShiftAssignmentId(data.shift_assignment_id) : null;
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
    validateShiftAssignmentReference(nextShiftAssignmentId),
    validateTaskReference(nextCleaningTaskId, CleaningTask, "Cleaning task not found"),
    validateTaskReference(nextMaintenanceTaskId, MaintenanceTask, "Maintenance task not found"),
  ]);

  if (!nextStock) throw createError("Inventory stock not found", 404);
  if (!nextStaff) throw createError("Staff user not found", 404);
  if (!nextStaff.isActive) throw createError("Staff user is inactive", 403);

  await validateCleanerOwnership({
    actor: effectiveActor,
    staffId: resolvedParticipants.staff_id,
    shiftAssignmentId: nextShiftAssignmentId,
    cleaningTaskId: nextCleaningTaskId,
    maintenanceTaskId: nextMaintenanceTaskId,
  });

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

exports.deleteInventoryActivityLog = async (id) => {
  const log = await InventoryActivityLog.findOne({ id });
  if (!log) throw createError("inventory activity log not found", 404);

  const delta = getStockDelta(log.action_type, log.quantity);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await applyStockDelta(log.inventory_stock_id, -delta, session);
    await InventoryActivityLog.deleteOne({ id }).session(session);

    await session.commitTransaction();
    return { message: "inventory activity log deleted successfully" };
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

  return InventoryActivityLog.create({
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

exports.getCleanerDailyActivityLogs = async (cleanerId, actor = null, options = {}) => {
  const normalizedCleanerId = normalizeCleanerId(cleanerId);
  if (!normalizedCleanerId) {
    throw createError("cleaner_id is required", 400);
  }

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorId = getUserIdentity(actor);
  if (actorRole === "cleaner" && String(actorId || "") !== normalizedCleanerId) {
    throw createError("Cleaners can only view their own checkout logs", 403);
  }

  const cleaner = await findStaffUser(normalizedCleanerId);
  if (!cleaner) {
    throw createError("Cleaner not found", 404);
  }

  const { dayStart, dayEnd } = buildDayRange(options.date);

  const logFilter = {
    staff_id: normalizedCleanerId,
    created_at: { $gte: dayStart, $lte: dayEnd },
  };
  if (options.action_type) {
    logFilter.action_type = normalizeActionType(options.action_type);
  }

  const logs = await InventoryActivityLog.find(logFilter)
    .sort({ created_at: -1 })
    .lean();

  if (logs.length === 0) {
    return {
      cleaner_id: normalizedCleanerId,
      date: dayStart.toISOString().slice(0, 10),
      day_start: dayStart,
      day_end: dayEnd,
      total_log_count: 0,
      total_quantity: 0,
      logs: [],
    };
  }

  const stockIds = [...new Set(logs.map((l) => String(l.inventory_stock_id || "")).filter(Boolean))];
  const stocks = await InventoryStock.find({ id: { $in: stockIds } })
    .select("id item_id warehouse_id")
    .lean();
  const stockById = new Map(stocks.map((s) => [String(s.id), s]));

  const itemIds = [...new Set(stocks.map((s) => String(s.item_id || "")).filter(Boolean))];
  const warehouseIds = [...new Set(stocks.map((s) => String(s.warehouse_id || "")).filter(Boolean))];

  const [items, warehouses] = await Promise.all([
    itemIds.length > 0 ? Item.find({ id: { $in: itemIds } }).select("id name").lean() : Promise.resolve([]),
    warehouseIds.length > 0 ? Warehouse.find({ id: { $in: warehouseIds } }).select("id name").lean() : Promise.resolve([]),
  ]);

  const itemById = new Map(items.map((i) => [String(i.id), i]));
  const warehouseById = new Map(warehouses.map((w) => [String(w.id), w]));

  const enrichedLogs = logs.map((log) => {
    const stock = stockById.get(String(log.inventory_stock_id || "")) || null;
    const item = stock ? itemById.get(String(stock.item_id || "")) || null : null;
    const warehouse = stock ? warehouseById.get(String(stock.warehouse_id || "")) || null : null;
    return {
      ...log,
      item_id: stock?.item_id || null,
      item_name: item?.name || null,
      warehouse_id: stock?.warehouse_id || null,
      warehouse_name: warehouse?.name || null,
    };
  });

  const totalQuantity = enrichedLogs.reduce((sum, l) => sum + Number(l.quantity || 0), 0);

  // Group by item for summary
  const summaryByItem = new Map();
  for (const log of enrichedLogs) {
    const itemId = String(log.item_id || "");
    if (!itemId) continue;
    if (!summaryByItem.has(itemId)) {
      summaryByItem.set(itemId, {
        item_id: itemId,
        item_name: log.item_name,
        checkout_quantity: 0,
        return_quantity: 0,
        waste_quantity: 0,
        log_count: 0,
      });
    }
    const entry = summaryByItem.get(itemId);
    const qty = Number(log.quantity || 0);
    if (log.action_type === "CHECKOUT") entry.checkout_quantity += qty;
    else if (log.action_type === "RETURN") entry.return_quantity += qty;
    else if (log.action_type === "WASTE") entry.waste_quantity += qty;
    entry.log_count += 1;
  }

  return {
    cleaner_id: normalizedCleanerId,
    date: dayStart.toISOString().slice(0, 10),
    day_start: dayStart,
    day_end: dayEnd,
    total_log_count: enrichedLogs.length,
    total_quantity: totalQuantity,
    summary_by_item: [...summaryByItem.values()],
    logs: enrichedLogs,
  };
};

exports.estimateByShiftAssignment = async (cleanerId, actor = null, options = {}) => {
  return exports.estimateByCleanerDay(cleanerId, actor, options);
};

exports.estimateByCleanerDay = async (cleanerId, actor = null, options = {}) => {
  const normalizedCleanerId = normalizeCleanerId(cleanerId);
  if (!normalizedCleanerId) {
    throw createError("cleaner_id is required", 400);
  }

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorId = getUserIdentity(actor);
  if (actorRole === "cleaner" && String(actorId || "") !== normalizedCleanerId) {
    throw createError("Cleaners can only estimate inventory for themselves", 403);
  }

  const cleaner = await findStaffUser(normalizedCleanerId);
  if (!cleaner) {
    throw createError("Cleaner not found", 404);
  }

  const { dayStart, dayEnd } = buildDayRange(options.date);
  const taskStatuses = ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS"];

  const assignments = await StaffShiftAssignment.find({
    staff_id: normalizedCleanerId,
    start_date: { $lte: dayEnd },
    end_date: { $gte: dayStart },
  })
    .select("id location_shift_id start_date end_date")
    .lean();

  if (assignments.length === 0) {
    throw createError("Cleaner is not scheduled to work in selected date", 400);
  }

  const assignmentIds = assignments.map((assignment) => String(assignment.id || "")).filter(Boolean);

  const tasks = await CleaningTask.find({
    cleaner_id: normalizedCleanerId,
    status: { $in: taskStatuses },
    estimated_start_time: { $gte: dayStart, $lte: dayEnd },
  })
    .select("id pod_id status shift_assignment_id")
    .lean();

  if (tasks.length === 0) {
    return {
      cleaner_id: normalizedCleanerId,
      date: dayStart.toISOString().slice(0, 10),
      day_start: dayStart,
      day_end: dayEnd,
      shift_assignment_ids: assignmentIds,
      location_ids: [],
      task_count: 0,
      pod_count: 0,
      warehouse_scope_ids: [],
      items: [],
      summary: {
        total_required_quantity: 0,
        total_available_quantity: 0,
        total_shortage_quantity: 0,
      },
    };
  }

  const locationShiftIds = [...new Set(assignments.map((item) => String(item.location_shift_id || "")).filter(Boolean))];
  const locationShifts = locationShiftIds.length > 0
    ? await LocationShift.find({ id: { $in: locationShiftIds } })
      .select("id location_id")
      .lean()
    : [];
  const locationIds = [...new Set(locationShifts.map((item) => String(item.location_id || "")).filter(Boolean))];

  const podIds = [...new Set(tasks.map((task) => String(task.pod_id || "")).filter(Boolean))];
  if (podIds.length === 0) {
    return {
      cleaner_id: normalizedCleanerId,
      date: dayStart.toISOString().slice(0, 10),
      day_start: dayStart,
      day_end: dayEnd,
      shift_assignment_ids: assignmentIds,
      location_ids: locationIds,
      task_count: tasks.length,
      pod_count: 0,
      warehouse_scope_ids: [],
      items: [],
      summary: {
        total_required_quantity: 0,
        total_available_quantity: 0,
        total_shortage_quantity: 0,
      },
    };
  }

  const podItems = await PodItem.find({ pod_id: { $in: podIds } })
    .select("pod_id item_id expected_quantity current_quantity")
    .lean();

  const podItemItemIds = [...new Set(podItems.map((item) => String(item.item_id || "")).filter(Boolean))];
  const consumableItems = podItemItemIds.length > 0
    ? await Item.find({ id: { $in: podItemItemIds }, item_type: "CONSUMABLE" })
      .select("id")
      .lean()
    : [];
  const consumableItemIdSet = new Set(consumableItems.map((item) => String(item.id || "")));

  // Count how many tasks are assigned to each pod (a pod may be cleaned multiple times)
  const taskCountByPod = new Map();
  for (const task of tasks) {
    const podId = String(task.pod_id || "");
    if (podId) {
      taskCountByPod.set(podId, (taskCountByPod.get(podId) || 0) + 1);
    }
  }

  const requiredByItem = new Map();
  for (const podItem of podItems) {
    const itemId = String(podItem.item_id || "");
    if (!itemId) continue;

    if (!consumableItemIdSet.has(itemId)) continue;

    const expectedPerPod = Math.max(0, Number(podItem.expected_quantity || 0));
    if (expectedPerPod <= 0) continue;

    // Multiply by number of tasks for this pod so repeated cleanings are counted
    const taskCount = taskCountByPod.get(String(podItem.pod_id || "")) || 1;
    const needed = expectedPerPod * taskCount;

    requiredByItem.set(itemId, (requiredByItem.get(itemId) || 0) + needed);
  }

  const itemIds = [...requiredByItem.keys()];
  if (itemIds.length === 0) {
    return {
      cleaner_id: normalizedCleanerId,
      date: dayStart.toISOString().slice(0, 10),
      day_start: dayStart,
      day_end: dayEnd,
      shift_assignment_ids: assignmentIds,
      location_ids: locationIds,
      task_count: tasks.length,
      pod_count: podIds.length,
      warehouse_scope_ids: [],
      items: [],
      summary: {
        total_required_quantity: 0,
        total_available_quantity: 0,
        total_shortage_quantity: 0,
      },
    };
  }

  const preferredWarehouseId = normalizeTaskId(options.warehouse_id);
  const locationWarehouses = locationIds.length > 0
    ? await LocationWarehouse.find({ location_id: { $in: locationIds } })
      .select("warehouse_id")
      .lean()
    : [];
  const linkedWarehouseIds = [...new Set(locationWarehouses.map((item) => String(item.warehouse_id || "")).filter(Boolean))];

  const warehouseScopeIds = preferredWarehouseId
    ? [preferredWarehouseId]
    : linkedWarehouseIds;

  const stockFilter = {
    item_id: { $in: itemIds },
  };
  if (warehouseScopeIds.length > 0) {
    stockFilter.warehouse_id = { $in: warehouseScopeIds };
  }

  const [stocks, items, warehouses] = await Promise.all([
    InventoryStock.find(stockFilter)
      .select("id item_id warehouse_id quantity_available")
      .lean(),
    Item.find({ id: { $in: itemIds } })
      .select("id name")
      .lean(),
    warehouseScopeIds.length > 0
      ? Warehouse.find({ id: { $in: warehouseScopeIds } })
        .select("id name")
        .lean()
      : Promise.resolve([]),
  ]);

  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const warehouseById = new Map(warehouses.map((item) => [String(item.id), item]));
  const stocksByItem = new Map();

  for (const stock of stocks) {
    const itemId = String(stock.item_id || "");
    if (!stocksByItem.has(itemId)) {
      stocksByItem.set(itemId, []);
    }
    stocksByItem.get(itemId).push(stock);
  }

  const estimationItems = itemIds.map((itemId) => {
    const requiredQuantity = Number(requiredByItem.get(itemId) || 0);
    const scopedStocks = stocksByItem.get(itemId) || [];
    const availableQuantity = scopedStocks.reduce((sum, stock) => sum + Number(stock.quantity_available || 0), 0);
    const shortageQuantity = Math.max(0, requiredQuantity - availableQuantity);

    return {
      item_id: itemId,
      item_name: itemById.get(itemId)?.name || null,
      required_quantity: requiredQuantity,
      available_quantity: availableQuantity,
      shortage_quantity: shortageQuantity,
      suggested_stocks: scopedStocks.map((stock) => ({
        inventory_stock_id: stock.id,
        warehouse_id: stock.warehouse_id,
        warehouse_name: warehouseById.get(String(stock.warehouse_id || ""))?.name || null,
        quantity_available: Number(stock.quantity_available || 0),
      })),
    };
  });

  const totalRequired = estimationItems.reduce((sum, item) => sum + item.required_quantity, 0);
  const totalAvailable = estimationItems.reduce((sum, item) => sum + item.available_quantity, 0);
  const totalShortage = estimationItems.reduce((sum, item) => sum + item.shortage_quantity, 0);

  return {
    cleaner_id: normalizedCleanerId,
    date: dayStart.toISOString().slice(0, 10),
    day_start: dayStart,
    day_end: dayEnd,
    shift_assignment_ids: assignmentIds,
    location_ids: locationIds,
    task_count: tasks.length,
    pod_count: podIds.length,
    warehouse_scope_ids: warehouseScopeIds,
    items: estimationItems,
    summary: {
      total_required_quantity: totalRequired,
      total_available_quantity: totalAvailable,
      total_shortage_quantity: totalShortage,
    },
  };
};
