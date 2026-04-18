const Item = require("../models/Item");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

exports.createItem = async (data) => {
  const { name, item_type, unit_cost } = data;
  if (!name) throw createError("Item name is required", 400);

  const existing = await Item.findOne({ name: name.trim() });
  if (existing) throw createError("An item with this name already exists", 409);

  const item = new Item({ name: name.trim(), item_type, unit_cost });
  await item.save();
  return item;
};

exports.getAllItems = async (query = {}) => {
  const filter = {};
  if (query.item_type) filter.item_type = query.item_type;
  if (query.name) filter.name = { $regex: query.name, $options: "i" };
  return Item.find(filter).sort({ created_at: -1 });
};

exports.getItemById = async (id) => {
  const item = await Item.findOne({ id });
  if (!item) throw createError("Item not found", 404);
  return item;
};

exports.updateItem = async (id, data) => {
  const item = await Item.findOne({ id });
  if (!item) throw createError("Item not found", 404);

  const { name, item_type, unit_cost } = data;

  if (name && name.trim() !== item.name) {
    const existing = await Item.findOne({ name: name.trim() });
    if (existing) throw createError("An item with this name already exists", 409);
    item.name = name.trim();
  }
  if (item_type !== undefined) item.item_type = item_type;
  if (unit_cost !== undefined) item.unit_cost = unit_cost;

  await item.save();
  return item;
};

exports.deleteItem = async (id) => {
  const item = await Item.findOne({ id });
  if (!item) throw createError("Item not found", 404);

  // Check if this item is used in any pod
  const PodItem = require("../models/PodItem");
  const usageCount = await PodItem.countDocuments({ item_id: id });
  if (usageCount > 0) {
    throw createError(
      `Cannot delete: item is assigned to ${usageCount} pod(s). Remove pod assignments first.`,
      409
    );
  }

  // Check if this item still has inventory stock records
  const InventoryStock = require("../models/InventoryStock");
  const stockCount = await InventoryStock.countDocuments({ item_id: id });
  if (stockCount > 0) {
    throw createError(
      `Cannot delete: item still has stock records in ${stockCount} warehouse(s). Remove or zero-out inventory stocks first.`,
      409
    );
  }

  await Item.deleteOne({ id });
  return { message: "Item deleted successfully" };
};
