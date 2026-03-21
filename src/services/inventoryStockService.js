const InventoryStock = require("../models/InventoryStock");
const Warehouse = require("../models/Warehouse");
const Item = require("../models/Item");
const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");
const inventoryCheckoutLogService = require("./inventoryCheckoutLogService");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

exports.createInventoryStock = async (data) => {
  const { warehouse_id, item_id, quantity_available = 0, staff_id } = data;

  if (!warehouse_id || !item_id) {
    throw createError("warehouse_id and item_id are required", 400);
  }

  const [warehouse, item] = await Promise.all([
    Warehouse.findOne({ id: warehouse_id }).select("id").lean(),
    Item.findOne({ id: item_id }).select("id").lean(),
  ]);

  if (!warehouse) throw createError("Warehouse not found", 404);
  if (!item) throw createError("Item not found", 404);

  const existing = await InventoryStock.findOne({ warehouse_id, item_id }).lean();
  if (existing) throw createError("Inventory stock already exists for this warehouse and item", 409);

  if (Number(quantity_available) < 0) {
    throw createError("quantity_available cannot be negative", 400);
  }

  const stock = await InventoryStock.create({
    warehouse_id,
    item_id,
    quantity_available: Number(quantity_available),
  });

  // Auto-log stock creation if staff_id provided
  if (staff_id) {
    try {
      await inventoryCheckoutLogService.createAutoLog({
        inventory_stock_id: stock.id,
        staff_id,
        quantity: Number(quantity_available),
        action_type: "INITIAL",
        reason: "Stock created",
      });
    } catch (logError) {
      console.error("Failed to create auto-log for stock creation:", logError);
      // Don't throw - stock creation succeeded, log failure is secondary
    }
  }

  return stock;
};

exports.getAllInventoryStocks = async (query = {}) => {
  const filter = {};
  if (query.warehouse_id) filter.warehouse_id = query.warehouse_id;
  if (query.item_id) filter.item_id = query.item_id;

  return InventoryStock.find(filter).sort({ updated_at: -1 });
};

exports.getInventoryStockById = async (id) => {
  const stock = await InventoryStock.findOne({ id });
  if (!stock) throw createError("Inventory stock not found", 404);
  return stock;
};

exports.updateInventoryStock = async (id, data) => {
  const { staff_id } = data;
  const stock = await InventoryStock.findOne({ id });
  if (!stock) throw createError("Inventory stock not found", 404);

  const nextWarehouseId = data.warehouse_id !== undefined ? data.warehouse_id : stock.warehouse_id;
  const nextItemId = data.item_id !== undefined ? data.item_id : stock.item_id;

  const [warehouse, item] = await Promise.all([
    Warehouse.findOne({ id: nextWarehouseId }).select("id").lean(),
    Item.findOne({ id: nextItemId }).select("id").lean(),
  ]);

  if (!warehouse) throw createError("Warehouse not found", 404);
  if (!item) throw createError("Item not found", 404);

  const duplicate = await InventoryStock.findOne({
    warehouse_id: nextWarehouseId,
    item_id: nextItemId,
    id: { $ne: id },
  }).lean();

  if (duplicate) throw createError("Inventory stock already exists for this warehouse and item", 409);

  // Track old quantity for auto-log
  const oldQuantity = stock.quantity_available;
  let quantityChanged = false;

  if (data.quantity_available !== undefined) {
    if (Number(data.quantity_available) < 0) {
      throw createError("quantity_available cannot be negative", 400);
    }
    const newQuantity = Number(data.quantity_available);
    if (newQuantity !== oldQuantity) {
      quantityChanged = true;
    }
    stock.quantity_available = newQuantity;
  }

  stock.warehouse_id = nextWarehouseId;
  stock.item_id = nextItemId;

  await stock.save();

  // Auto-log quantity adjustment if changed and staff_id provided
  if (quantityChanged && staff_id) {
    try {
      await inventoryCheckoutLogService.createAutoLog({
        inventory_stock_id: stock.id,
        staff_id,
        quantity: stock.quantity_available,
        action_type: "ADJUSTMENT",
        reason: "Stock quantity adjusted",
      });
    } catch (logError) {
      console.error("Failed to create auto-log for stock adjustment:", logError);
      // Don't throw - stock update succeeded, log failure is secondary
    }
  }

  return stock;
};

exports.deleteInventoryStock = async (id) => {
  const stock = await InventoryStock.findOne({ id });
  if (!stock) throw createError("Inventory stock not found", 404);

  const logCount = await InventoryCheckoutLog.countDocuments({ inventory_stock_id: id });
  if (logCount > 0) {
    throw createError("Cannot delete inventory stock because checkout logs exist", 409);
  }

  await InventoryStock.deleteOne({ id });
  return { message: "Inventory stock deleted successfully" };
};
