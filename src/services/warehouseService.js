const Warehouse = require("../models/Warehouse");
const LocationWarehouse = require("../models/LocationWarehouse");
const InventoryStock = require("../models/InventoryStock");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

exports.createWarehouse = async (data) => {
  const { name, address } = data;
  if (!name) throw createError("Warehouse name is required", 400);

  const existing = await Warehouse.findOne({ name: name.trim() });
  if (existing) throw createError("A warehouse with this name already exists", 409);

  const warehouse = new Warehouse({ name: name.trim(), address });
  await warehouse.save();
  return warehouse;
};

exports.getAllWarehouses = async (query = {}) => {
  const filter = {};
  if (query.name) filter.name = { $regex: query.name, $options: "i" };

  if (query.location_ids) {
    const ids = Array.isArray(query.location_ids) 
      ? query.location_ids 
      : String(query.location_ids).split(",");
    
    const mappings = await LocationWarehouse.find({ location_id: { $in: ids } })
      .select("warehouse_id")
      .lean();
    
    const warehouseIds = mappings.map(m => m.warehouse_id);
    filter.id = { $in: warehouseIds };
  }

  return Warehouse.find(filter).sort({ created_at: -1 });
};

exports.getWarehouseById = async (id) => {
  const warehouse = await Warehouse.findOne({ id });
  if (!warehouse) throw createError("Warehouse not found", 404);
  return warehouse;
};

exports.updateWarehouse = async (id, data) => {
  const warehouse = await Warehouse.findOne({ id });
  if (!warehouse) throw createError("Warehouse not found", 404);

  if (data.name && data.name.trim() !== warehouse.name) {
    const existing = await Warehouse.findOne({ name: data.name.trim() });
    if (existing) throw createError("A warehouse with this name already exists", 409);
    warehouse.name = data.name.trim();
  }

  if (data.address !== undefined) warehouse.address = data.address;

  await warehouse.save();
  return warehouse;
};

exports.deleteWarehouse = async (id) => {
  const warehouse = await Warehouse.findOne({ id });
  if (!warehouse) throw createError("Warehouse not found", 404);

  const [locationMappingCount, stockCount] = await Promise.all([
    LocationWarehouse.countDocuments({ warehouse_id: id }),
    InventoryStock.countDocuments({ warehouse_id: id }),
  ]);

  if (locationMappingCount > 0) {
    throw createError("Cannot delete warehouse because location mappings exist", 409);
  }

  if (stockCount > 0) {
    throw createError("Cannot delete warehouse because inventory stocks exist", 409);
  }

  await Warehouse.deleteOne({ id });
  return { message: "Warehouse deleted successfully" };
};
