const CleaningBufferPolicy = require("../models/CleaningBufferPolicy");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeNullableString = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeBufferMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createError("buffer_minutes must be an integer >= 0", 400);
  }
  return parsed;
};

exports.getAllPolicies = async (query = {}) => {
  const filter = {};

  if (query.location_id !== undefined) filter.location_id = normalizeNullableString(query.location_id);
  if (query.cluster_id !== undefined) filter.cluster_id = normalizeNullableString(query.cluster_id);
  if (query.pod_id !== undefined) filter.pod_id = normalizeNullableString(query.pod_id);
  if (query.is_active !== undefined) filter.is_active = String(query.is_active).toLowerCase() === "true";

  return CleaningBufferPolicy.find(filter).sort({ created_at: -1 });
};

exports.getPolicyById = async (id) => {
  const policy = await CleaningBufferPolicy.findOne({ id });
  if (!policy) throw createError("Cleaning buffer policy not found", 404);
  return policy;
};

exports.createPolicy = async (data = {}) => {
  if (data.buffer_minutes === undefined) {
    throw createError("buffer_minutes is required", 400);
  }

  const payload = {
    location_id: normalizeNullableString(data.location_id),
    cluster_id: normalizeNullableString(data.cluster_id),
    pod_id: normalizeNullableString(data.pod_id),
    buffer_minutes: normalizeBufferMinutes(data.buffer_minutes),
    is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
  };

  return CleaningBufferPolicy.create(payload);
};

exports.updatePolicy = async (id, data = {}) => {
  const policy = await exports.getPolicyById(id);

  if (data.location_id !== undefined) policy.location_id = normalizeNullableString(data.location_id);
  if (data.cluster_id !== undefined) policy.cluster_id = normalizeNullableString(data.cluster_id);
  if (data.pod_id !== undefined) policy.pod_id = normalizeNullableString(data.pod_id);
  if (data.buffer_minutes !== undefined) policy.buffer_minutes = normalizeBufferMinutes(data.buffer_minutes);
  if (data.is_active !== undefined) policy.is_active = Boolean(data.is_active);

  await policy.save();
  return policy;
};

exports.deletePolicy = async (id) => {
  const policy = await exports.getPolicyById(id);
  await CleaningBufferPolicy.deleteOne({ id });
  return policy;
};
