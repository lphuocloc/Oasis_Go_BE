const InventoryStock = require("../models/InventoryStock");
const Warehouse = require("../models/Warehouse");
const Item = require("../models/Item");
const InventoryCheckoutLog = require("../models/InventoryCheckoutLog");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

exports.createInventoryStock = async (data) => {
  const { warehouse_id, item_id, quantity_available = 0 } = data;

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

  return InventoryStock.create({
    warehouse_id,
    item_id,
    quantity_available: Number(quantity_available),
  });
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

  if (data.quantity_available !== undefined) {
    if (Number(data.quantity_available) < 0) {
      throw createError("quantity_available cannot be negative", 400);
    }
    stock.quantity_available = Number(data.quantity_available);
  }

  stock.warehouse_id = nextWarehouseId;
  stock.item_id = nextItemId;

  await stock.save();
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
