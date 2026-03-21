const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");
const InventoryStock = require("../models/InventoryStock");
const User = require("../models/User");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const findStaffUser = async (staffId) => {
  if (!staffId) return null;

  // Primary lookup by Mongo ObjectId (req.user.id from auth middleware)
  const byObjectId = await User.findById(staffId).select("_id role isActive").lean();
  if (byObjectId) return byObjectId;

  // Fallback for systems using a custom "id" field
  return User.findOne({ id: staffId }).select("_id role isActive").lean();
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

const applyStockDelta = async (stockId, delta) => {
  const stock = await InventoryStock.findOne({ id: stockId });
  if (!stock) throw createError("Inventory stock not found", 404);

  const nextQty = Number(stock.quantity_available) + Number(delta);
  if (nextQty < 0) {
    throw createError("Insufficient stock for this operation", 409);
  }

  stock.quantity_available = nextQty;
  await stock.save();
  return stock;
};

exports.createInventoryCheckoutLog = async (data) => {
  const {
    inventory_stock_id,
    staff_id,
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

  const [stock, staff] = await Promise.all([
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available").lean(),
    findStaffUser(staff_id),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  const delta = getStockDelta(normalizedActionType, normalizedQuantity);
  await applyStockDelta(inventory_stock_id, delta);

  return InventoryCheckoutLog.create({
    inventory_stock_id,
    staff_id,
    cleaning_task_id: normalizedCleaningTaskId,
    maintenance_task_id: normalizedMaintenanceTaskId,
    quantity: normalizedQuantity,
    action_type: normalizedActionType,
    reason: normalizedReason,
  });
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

exports.updateInventoryCheckoutLog = async (id, data) => {
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

  const [nextStock, nextStaff] = await Promise.all([
    InventoryStock.findOne({ id: nextInventoryStockId }).select("id").lean(),
    findStaffUser(nextStaffId),
  ]);

  if (!nextStock) throw createError("Inventory stock not found", 404);
  if (!nextStaff) throw createError("Staff user not found", 404);
  if (!nextStaff.isActive) throw createError("Staff user is inactive", 403);

  const oldDelta = getStockDelta(log.action_type, log.quantity);
  await applyStockDelta(log.inventory_stock_id, -oldDelta);

  try {
    const newDelta = getStockDelta(nextActionType, nextQuantity);
    await applyStockDelta(nextInventoryStockId, newDelta);
  } catch (error) {
    await applyStockDelta(log.inventory_stock_id, oldDelta);
    throw error;
  }

  log.inventory_stock_id = nextInventoryStockId;
  log.staff_id = nextStaffId;
  log.action_type = nextActionType;
  log.quantity = nextQuantity;
  log.cleaning_task_id = nextCleaningTaskId;
  log.maintenance_task_id = nextMaintenanceTaskId;
  log.reason = nextReason;

  await log.save();
  return log;
};

exports.deleteInventoryCheckoutLog = async (id) => {
  const log = await InventoryCheckoutLog.findOne({ id });
  if (!log) throw createError("Inventory checkout log not found", 404);

  const delta = getStockDelta(log.action_type, log.quantity);
  await applyStockDelta(log.inventory_stock_id, -delta);

  await InventoryCheckoutLog.deleteOne({ id });
  return { message: "Inventory checkout log deleted successfully" };
};

exports.createAutoLog = async ({ inventory_stock_id, staff_id, quantity, action_type, reason }) => {
  if (!inventory_stock_id || !staff_id) {
    throw createError("inventory_stock_id and staff_id are required", 400);
  }

  const normalizedActionType = normalizeActionType(action_type);
  const normalizedQuantity = normalizeQuantity(quantity);
  const normalizedReason = reason === undefined || reason === null ? null : String(reason).trim();

  const [stock, staff] = await Promise.all([
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available").lean(),
    findStaffUser(staff_id),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  return InventoryCheckoutLog.create({
    inventory_stock_id,
    staff_id,
    cleaning_task_id: null,
    maintenance_task_id: null,
    quantity: normalizedQuantity,
    action_type: normalizedActionType,
    reason: normalizedReason,
  });
};
