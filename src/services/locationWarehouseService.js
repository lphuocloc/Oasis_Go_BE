const LocationWarehouse = require("../models/LocationWarehouse");
const Location = require("../models/Location");
const Warehouse = require("../models/Warehouse");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const resolveEffectiveMappings = async (locationId, includeTrace = false) => {
  const startLocation = await Location.findOne({ id: locationId }).select("id parent_id").lean();
  if (!startLocation) {
    throw createError("Location not found", 404);
  }

  const visited = new Set();
  const trace = [];

  let depth = 0;
  let current = startLocation;

  while (current) {
    if (visited.has(current.id)) {
      throw createError("Location hierarchy contains a cycle", 400);
    }

    visited.add(current.id);

    const directMappings = await LocationWarehouse.find({ location_id: current.id })
      .sort({ created_at: -1 })
      .lean();

    if (includeTrace) {
      trace.push({
        location_id: current.id,
        depth,
        mapping_count: directMappings.length,
        matched: directMappings.length > 0,
      });
    }

    if (directMappings.length > 0) {
      return {
        data: directMappings.map((mapping) => ({
          ...mapping,
          requested_location_id: startLocation.id,
          source_type: depth === 0 ? "direct" : "inherited",
          source_location_id: current.id,
          resolution_depth: depth,
        })),
        trace,
      };
    }

    if (!current.parent_id) {
      break;
    }

    current = await Location.findOne({ id: current.parent_id }).select("id parent_id").lean();
    depth += 1;
  }

  return { data: [], trace };
};

exports.createLocationWarehouse = async (data) => {
  const { location_id, warehouse_id } = data;

  if (!location_id || !warehouse_id) {
    throw createError("location_id and warehouse_id are required", 400);
  }

  const [location, warehouse] = await Promise.all([
    Location.findOne({ id: location_id }).select("id").lean(),
    Warehouse.findOne({ id: warehouse_id }).select("id").lean(),
  ]);

  if (!location) throw createError("Location not found", 404);
  if (!warehouse) throw createError("Warehouse not found", 404);

  const existing = await LocationWarehouse.findOne({ location_id, warehouse_id }).lean();
  if (existing) {
    throw createError("Location-warehouse mapping already exists", 409);
  }

  return LocationWarehouse.create({ location_id, warehouse_id });
};

exports.getAllLocationWarehouses = async (query = {}) => {
  const filter = {};
  if (query.location_id) filter.location_id = query.location_id;
  if (query.warehouse_id) filter.warehouse_id = query.warehouse_id;

  return LocationWarehouse.find(filter).sort({ created_at: -1 });
};

exports.getLocationWarehouseById = async (id) => {
  const mapping = await LocationWarehouse.findOne({ id });
  if (!mapping) throw createError("Location-warehouse mapping not found", 404);
  return mapping;
};

exports.updateLocationWarehouse = async (id, data) => {
  const mapping = await LocationWarehouse.findOne({ id });
  if (!mapping) throw createError("Location-warehouse mapping not found", 404);

  const nextLocationId = data.location_id !== undefined ? data.location_id : mapping.location_id;
  const nextWarehouseId = data.warehouse_id !== undefined ? data.warehouse_id : mapping.warehouse_id;

  const [location, warehouse] = await Promise.all([
    Location.findOne({ id: nextLocationId }).select("id").lean(),
    Warehouse.findOne({ id: nextWarehouseId }).select("id").lean(),
  ]);

  if (!location) throw createError("Location not found", 404);
  if (!warehouse) throw createError("Warehouse not found", 404);

  const duplicate = await LocationWarehouse.findOne({
    location_id: nextLocationId,
    warehouse_id: nextWarehouseId,
    id: { $ne: id },
  }).lean();

  if (duplicate) {
    throw createError("Location-warehouse mapping already exists", 409);
  }

  mapping.location_id = nextLocationId;
  mapping.warehouse_id = nextWarehouseId;

  await mapping.save();
  return mapping;
};

exports.deleteLocationWarehouse = async (id) => {
  const mapping = await LocationWarehouse.findOne({ id });
  if (!mapping) throw createError("Location-warehouse mapping not found", 404);

  await LocationWarehouse.deleteOne({ id });
  return { message: "Location-warehouse mapping deleted successfully" };
};

exports.getEffectiveLocationWarehouses = async (locationId) => {
  const result = await resolveEffectiveMappings(locationId, false);
  return result.data;
};

exports.getEffectiveLocationWarehousesDebug = async (locationId) => {
  return resolveEffectiveMappings(locationId, true);
};
