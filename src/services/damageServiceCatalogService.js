const DamageServiceCatalog = require("../models/DamageServiceCatalog");
const IncidentDetail = require("../models/IncidentDetail");

const SERVICE_CATEGORIES = ["CONSTRUCTION", "CLEANING", "PENALTY"];

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeCategory = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().toUpperCase();
};

const parseNonNegativeNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError(`${fieldName} must be a non-negative number`, 400);
  }
  return parsed;
};

const parseOptionalBoolean = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw createError(`${fieldName} must be true or false`, 400);
};

const ensureValidCategory = (category) => {
  if (category === null) return;
  if (!SERVICE_CATEGORIES.includes(category)) {
    throw createError(`Invalid category. Must be one of: ${SERVICE_CATEGORIES.join(", ")}`, 400);
  }
};

const findDuplicateByName = async (name, excludeId = null) => {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;

  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = {
    name: { $regex: `^${escaped}$`, $options: "i" },
  };

  if (excludeId) {
    filter.id = { $ne: String(excludeId) };
  }

  return DamageServiceCatalog.findOne(filter).lean();
};

exports.createDamageServiceCatalog = async (data = {}) => {
  const name = String(data.name || "").trim();
  if (!name) throw createError("name is required", 400);

  const category = normalizeCategory(data.category);
  ensureValidCategory(category);

  const duplicate = await findDuplicateByName(name);
  if (duplicate) {
    throw createError("A damage service catalog with this name already exists", 409);
  }

  const basePrice = parseNonNegativeNumber(data.base_price, "base_price");
  const isActive = parseOptionalBoolean(data.is_active, "is_active");

  const catalog = await DamageServiceCatalog.create({
    name,
    category,
    base_price: basePrice !== undefined ? basePrice : 0,
    unit_name: data.unit_name !== undefined ? String(data.unit_name || "").trim() || null : null,
    description: data.description !== undefined ? String(data.description || "").trim() || null : null,
    is_active: isActive !== undefined ? isActive : true,
  });

  return catalog;
};

exports.getAllDamageServiceCatalogs = async (query = {}) => {
  const filter = {};

  if (query.name) {
    filter.name = { $regex: String(query.name).trim(), $options: "i" };
  }

  if (query.category !== undefined) {
    const category = normalizeCategory(query.category);
    ensureValidCategory(category);
    filter.category = category;
  }

  if (query.is_active !== undefined) {
    filter.is_active = parseOptionalBoolean(query.is_active, "is_active");
  }

  return DamageServiceCatalog.find(filter).sort({ created_at: -1 });
};

exports.getDamageServiceCatalogById = async (id) => {
  const catalog = await DamageServiceCatalog.findOne({ id: String(id) });
  if (!catalog) throw createError("Damage service catalog not found", 404);
  return catalog;
};

exports.updateDamageServiceCatalog = async (id, data = {}) => {
  const catalog = await DamageServiceCatalog.findOne({ id: String(id) });
  if (!catalog) throw createError("Damage service catalog not found", 404);

  if (data.name !== undefined) {
    const nextName = String(data.name || "").trim();
    if (!nextName) throw createError("name cannot be empty", 400);

    if (nextName.toLowerCase() !== String(catalog.name || "").trim().toLowerCase()) {
      const duplicate = await findDuplicateByName(nextName, catalog.id);
      if (duplicate) {
        throw createError("A damage service catalog with this name already exists", 409);
      }
    }

    catalog.name = nextName;
  }

  if (data.category !== undefined) {
    const category = normalizeCategory(data.category);
    ensureValidCategory(category);
    catalog.category = category;
  }

  if (data.base_price !== undefined) {
    catalog.base_price = parseNonNegativeNumber(data.base_price, "base_price");
  }

  if (data.unit_name !== undefined) {
    catalog.unit_name = String(data.unit_name || "").trim() || null;
  }

  if (data.description !== undefined) {
    catalog.description = String(data.description || "").trim() || null;
  }

  if (data.is_active !== undefined) {
    catalog.is_active = parseOptionalBoolean(data.is_active, "is_active");
  }

  await catalog.save();
  return catalog;
};

exports.deleteDamageServiceCatalog = async (id) => {
  const catalog = await DamageServiceCatalog.findOne({ id: String(id) });
  if (!catalog) throw createError("Damage service catalog not found", 404);

  const usageCount = await IncidentDetail.countDocuments({ service_catalog_id: String(id) });
  if (usageCount > 0) {
    throw createError(
      `Cannot delete: catalog is used by ${usageCount} incident detail record(s).`,
      409
    );
  }

  await DamageServiceCatalog.deleteOne({ id: String(id) });
  return { message: "Damage service catalog deleted successfully" };
};
