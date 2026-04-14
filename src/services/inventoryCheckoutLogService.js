const mongoose = require("mongoose");
const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");
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

  if (!shiftAssignmentId && !cleaningTaskId) {
    throw createError("Cleaner requests must include shift_assignment_id or cleaning_task_id", 400);
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

exports.createInventoryCheckoutLog = async (data, actor = null) => {
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

    if (String(staff.role || "").toLowerCase() === "cleaner" && normalizedActionType === "CHECKOUT") {
      const [item, warehouse] = await Promise.all([
        Item.findOne({ id: stock.item_id }).select("id name").lean(),
        Warehouse.findOne({ id: stock.warehouse_id }).select("id name").lean(),
      ]);

      await notificationService.sendToUser(staff._id, {
        title: "Xac nhan xuat kho",
        message: `Ban da xuat ${normalizedQuantity} ${item?.name || "vat tu"} tu kho ${warehouse?.name || "Unknown"}.`,
        type: "INVENTORY",
        event_code: "INVENTORY_CHECKOUT_CONFIRMED",
        dedupe_key: `INVENTORY_CHECKOUT_CONFIRMED:${createdLog.id}:${String(staff._id)}`,
        data: {
          checkout_log_id: createdLog.id,
          inventory_stock_id,
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

exports.estimateByShiftAssignment = async (shiftAssignmentId, actor = null, options = {}) => {
  const normalizedShiftAssignmentId = normalizeShiftAssignmentId(shiftAssignmentId);
  if (!normalizedShiftAssignmentId) {
    throw createError("shift_assignment_id is required", 400);
  }

  const assignment = await StaffShiftAssignment.findOne({ id: normalizedShiftAssignmentId })
    .select("id staff_id location_shift_id")
    .lean();
  if (!assignment) {
    throw createError("Shift assignment not found", 404);
  }

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorId = getUserIdentity(actor);
  if (actorRole === "cleaner" && String(assignment.staff_id || "") !== String(actorId || "")) {
    throw createError("You are not owner of this shift assignment", 403);
  }

  const locationShift = await LocationShift.findOne({ id: assignment.location_shift_id })
    .select("id location_id")
    .lean();
  if (!locationShift) {
    throw createError("Location shift not found", 404);
  }

  const includeDone = String(options.include_done || "false").toLowerCase() === "true";
  const taskStatuses = includeDone
    ? ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS", "DONE"]
    : ["ASSIGNED", "NOTIFIED", "ACCEPTED", "IN_PROGRESS"];

  const tasks = await CleaningTask.find({
    shift_assignment_id: normalizedShiftAssignmentId,
    status: { $in: taskStatuses },
  })
    .select("id pod_id status")
    .lean();

  const podIds = [...new Set(tasks.map((task) => String(task.pod_id || "")).filter(Boolean))];
  if (podIds.length === 0) {
    return {
      shift_assignment_id: normalizedShiftAssignmentId,
      location_id: locationShift.location_id,
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

  const podItems = await PodItem.find({ pod_id: { $in: podIds } })
    .select("pod_id item_id expected_quantity current_quantity")
    .lean();

  const requiredByItem = new Map();
  for (const podItem of podItems) {
    const itemId = String(podItem.item_id || "");
    if (!itemId) continue;

    const expected = Number(podItem.expected_quantity || 0);
    const current = Number(podItem.current_quantity || 0);
    const needed = Math.max(0, expected - current);

    if (needed <= 0) continue;
    requiredByItem.set(itemId, (requiredByItem.get(itemId) || 0) + needed);
  }

  const itemIds = [...requiredByItem.keys()];
  if (itemIds.length === 0) {
    return {
      shift_assignment_id: normalizedShiftAssignmentId,
      location_id: locationShift.location_id,
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
  const locationWarehouses = await LocationWarehouse.find({ location_id: locationShift.location_id })
    .select("warehouse_id")
    .lean();
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
    shift_assignment_id: normalizedShiftAssignmentId,
    location_id: locationShift.location_id,
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
