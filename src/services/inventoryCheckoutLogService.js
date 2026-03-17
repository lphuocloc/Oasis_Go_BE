const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");
const InventoryStock = require("../models/InventoryStock");
const User = require("../models/User");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createError("quantity must be a positive number", 400);
  }
  return Math.floor(quantity);
};

const getStockDelta = (actionType, quantity) => {
  if (actionType === "RETURN") return quantity;
  if (actionType === "CHECKOUT" || actionType === "WASTE") return -quantity;
  throw createError("Invalid action_type", 400);
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
    cleaning_task_id = null,
    maintenance_task_id = null,
    quantity,
    action_type,
    reason,
  } = data;

  if (!inventory_stock_id || !staff_id || !action_type) {
    throw createError("inventory_stock_id, staff_id and action_type are required", 400);
  }

  const normalizedQuantity = normalizeQuantity(quantity);

  const [stock, staff] = await Promise.all([
    InventoryStock.findOne({ id: inventory_stock_id }).select("id quantity_available").lean(),
    User.findOne({ id: staff_id }).select("id role isActive").lean(),
  ]);

  if (!stock) throw createError("Inventory stock not found", 404);
  if (!staff) throw createError("Staff user not found", 404);
  if (!staff.isActive) throw createError("Staff user is inactive", 403);

  const delta = getStockDelta(action_type, normalizedQuantity);
  await applyStockDelta(inventory_stock_id, delta);

  return InventoryCheckoutLog.create({
    inventory_stock_id,
    staff_id,
    cleaning_task_id,
    maintenance_task_id,
    quantity: normalizedQuantity,
    action_type,
    reason,
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
  const nextActionType = data.action_type !== undefined ? data.action_type : log.action_type;
  const nextQuantity = data.quantity !== undefined ? normalizeQuantity(data.quantity) : log.quantity;

  const [nextStock, nextStaff] = await Promise.all([
    InventoryStock.findOne({ id: nextInventoryStockId }).select("id").lean(),
    User.findOne({ id: nextStaffId }).select("id isActive").lean(),
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
  if (data.cleaning_task_id !== undefined) log.cleaning_task_id = data.cleaning_task_id;
  if (data.maintenance_task_id !== undefined) log.maintenance_task_id = data.maintenance_task_id;
  if (data.reason !== undefined) log.reason = data.reason;

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
