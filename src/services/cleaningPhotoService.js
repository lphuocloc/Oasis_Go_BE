const CleaningPhoto = require("../models/CleaningPhoto");
const CleaningTask = require("../models/CleaningTask");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeType = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const validateType = (value) => {
  const allowedTypes = ["BEFORE", "AFTER"];
  if (value && !allowedTypes.includes(value)) {
    throw createError(`Invalid type. Must be one of: ${allowedTypes.join(", ")}`, 400);
  }
};

exports.createCleaningPhoto = async (data) => {
  const { cleaning_task_id, photo_url, type } = data;

  if (!cleaning_task_id || !photo_url || !type) {
    throw createError("cleaning_task_id, photo_url and type are required", 400);
  }

  const normalizedType = normalizeType(type);
  validateType(normalizedType);

  const task = await CleaningTask.findOne({ id: cleaning_task_id }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  return CleaningPhoto.create({
    cleaning_task_id,
    photo_url,
    type: normalizedType,
  });
};

exports.getAllCleaningPhotos = async (query = {}) => {
  const filter = {};

  if (query.cleaning_task_id) filter.cleaning_task_id = query.cleaning_task_id;
  if (query.type) {
    const normalizedType = normalizeType(query.type);
    validateType(normalizedType);
    filter.type = normalizedType;
  }

  return CleaningPhoto.find(filter).sort({ created_at: -1 });
};

exports.getCleaningPhotoById = async (id) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);
  return photo;
};

exports.updateCleaningPhoto = async (id, data) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);

  const nextTaskId = data.cleaning_task_id !== undefined ? data.cleaning_task_id : photo.cleaning_task_id;
  const nextType = data.type !== undefined ? normalizeType(data.type) : photo.type;
  validateType(nextType);

  const task = await CleaningTask.findOne({ id: nextTaskId }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  photo.cleaning_task_id = nextTaskId;
  photo.photo_url = data.photo_url !== undefined ? data.photo_url : photo.photo_url;
  photo.type = nextType;

  await photo.save();
  return photo;
};

exports.deleteCleaningPhoto = async (id) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);

  await CleaningPhoto.deleteOne({ id });
  return { message: "Cleaning photo deleted successfully" };
};
