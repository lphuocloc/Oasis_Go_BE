const CleaningPhoto = require("../models/CleaningPhoto");
const CleaningTask = require("../models/CleaningTask");
const { cloudinary } = require("../config/cloudinary");
const sharp = require("sharp");
const https = require("https");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const createErrorWithCode = (message, statusCode, errorCode) => {
  const err = createError(message, statusCode);
  err.errorCode = errorCode;
  return err;
};

const BASE64_IMAGE_DATA_URI_REGEX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/;
const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES_AFTER_PREPROCESS = 6 * 1024 * 1024;
const TARGET_LONG_EDGE = 1920;
const CLOUDINARY_UPLOAD_AGENT = new https.Agent({
  keepAlive: true,
  timeout: 180000,
});

const isBase64ImageDataUri = (value) => {
  if (!value || typeof value !== "string") return false;
  return BASE64_IMAGE_DATA_URI_REGEX.test(String(value).trim());
};

const decodeBase64ImageDataUri = (dataUri) => {
  if (!isBase64ImageDataUri(dataUri)) {
    throw createErrorWithCode("Invalid base64 image data", 400, "INVALID_BASE64_IMAGE_DATA");
  }

  const trimmed = String(dataUri).trim();
  const matched = trimmed.match(BASE64_IMAGE_DATA_URI_REGEX);
  const mimeType = matched ? matched[1] : "image/jpeg";
  const base64Payload = trimmed.replace(BASE64_IMAGE_DATA_URI_REGEX, "");

  let buffer;
  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch (_) {
    throw createErrorWithCode("Invalid base64 image payload", 400, "INVALID_BASE64_IMAGE_DATA");
  }

  if (!buffer || buffer.length === 0) {
    throw createErrorWithCode("Image payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
  }

  return { buffer, mimeType };
};

const preprocessImageBuffer = async ({ buffer, mimeType }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createErrorWithCode("Image payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
  }

  if (buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    throw createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
  }

  const lowerMime = String(mimeType || "").toLowerCase();
  const shouldUseJpeg = lowerMime.includes("jpeg") || lowerMime.includes("jpg");

  try {
    const image = sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: TARGET_LONG_EDGE,
        height: TARGET_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });

    const convertedBuffer = shouldUseJpeg
      ? await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      : await image.webp({ quality: 82, effort: 4 }).toBuffer();

    const optimizedBuffer =
      convertedBuffer.length > 0 && convertedBuffer.length < buffer.length
        ? convertedBuffer
        : buffer;

    if (optimizedBuffer.length > MAX_IMAGE_BYTES_AFTER_PREPROCESS) {
      throw createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
    }

    return {
      buffer: optimizedBuffer,
      mimeType: shouldUseJpeg ? "image/jpeg" : "image/webp",
    };
  } catch (error) {
    if (error?.errorCode) throw error;

    if (buffer.length > MAX_IMAGE_BYTES_AFTER_PREPROCESS) {
      throw createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
    }

    return {
      buffer,
      mimeType: mimeType || "image/jpeg",
    };
  }
};

const mapCloudinaryUploadError = (error) => {
  const providerMessage = String(error?.error?.message || error?.message || "");
  const lower = providerMessage.toLowerCase();

  const isTimeout =
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    error?.http_code === 499;

  if (isTimeout) {
    return createErrorWithCode("Request Timeout", 504, "CLOUDINARY_UPLOAD_TIMEOUT");
  }

  if (lower.includes("file size too large")) {
    return createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
  }

  if (lower.includes("invalid image") || lower.includes("unsupported")) {
    return createErrorWithCode("Invalid image format", 400, "CLOUDINARY_INVALID_IMAGE");
  }

  const err = createErrorWithCode("Failed to upload image to Cloudinary", 502, "CLOUDINARY_UPLOAD_FAILED");
  err.providerMessage = providerMessage || null;
  return err;
};

const uploadBufferToCloudinary = async ({ buffer, mimeType }) => {
  const preprocessed = await preprocessImageBuffer({ buffer, mimeType });

  const attemptUpload = () =>
    new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder: "oasisgo/cleaning-tasks",
          resource_type: "image",
          overwrite: false,
          timeout: 180000,
          agent: CLOUDINARY_UPLOAD_AGENT,
        },
        (error, result) => {
          if (error) return reject(error);
          return resolve(result);
        }
      );

      upload.on("error", reject);
      upload.end(preprocessed.buffer);
    });

  const bufferSize = Buffer.isBuffer(preprocessed.buffer) ? preprocessed.buffer.length : 0;
  if (bufferSize <= 0) {
    throw createErrorWithCode("Image payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
  }

  try {
    const uploaded = await attemptUpload();
    return {
      photo_url: uploaded?.secure_url || uploaded?.url || null,
      photo_public_id: uploaded?.public_id || null,
      mime_type: preprocessed.mimeType || mimeType || null,
    };
  } catch (firstError) {
    const mapped = mapCloudinaryUploadError(firstError);
    const shouldRetry = mapped.errorCode === "CLOUDINARY_UPLOAD_TIMEOUT";
    if (!shouldRetry) {
      throw mapped;
    }

    try {
      const uploaded = await attemptUpload();
      return {
        photo_url: uploaded?.secure_url || uploaded?.url || null,
        photo_public_id: uploaded?.public_id || null,
        mime_type: preprocessed.mimeType || mimeType || null,
      };
    } catch (retryError) {
      throw mapCloudinaryUploadError(retryError);
    }
  }
};

const uploadBase64ToCloudinary = async (dataUri) => {
  try {
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: "oasisgo/cleaning-tasks",
      resource_type: "image",
      overwrite: false,
      timeout: 60000,
      agent: CLOUDINARY_UPLOAD_AGENT,
    });

    return {
      photo_url: uploaded?.secure_url || uploaded?.url || null,
      photo_public_id: uploaded?.public_id || null,
    };
  } catch (error) {
    throw mapCloudinaryUploadError(error);
  }
};

const resolvePhotoAsset = async ({ photo_url, photo_public_id, photo_buffer, photo_mime_type }) => {
  if (photo_buffer) {
    return await uploadBufferToCloudinary({
      buffer: photo_buffer,
      mimeType: photo_mime_type,
    });
  }

  if (isBase64ImageDataUri(photo_url)) {
    const decoded = decodeBase64ImageDataUri(photo_url);
    return await uploadBufferToCloudinary({
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
    });
  }

  return {
    photo_url,
    photo_public_id,
  };
};

const serializeCleaningPhoto = (photo) => {
  if (!photo) return photo;

  const raw = typeof photo.toObject === "function" ? photo.toObject() : { ...photo };

  return {
    ...raw,
    image: {
      url: raw.photo_url || null,
      public_id: raw.photo_public_id || null,
    },
  };
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
  const { cleaning_task_id, type } = data;
  const resolvedAsset = await resolvePhotoAsset({
    photo_url: data.photo_url,
    photo_public_id: data.photo_public_id,
    photo_buffer: data.photo_buffer,
    photo_mime_type: data.photo_mime_type,
  });
  const { photo_url, photo_public_id } = resolvedAsset;

  if (!cleaning_task_id || !photo_url || !type) {
    throw createError("cleaning_task_id, photo_url and type are required", 400);
  }

  const normalizedType = normalizeType(type);
  validateType(normalizedType);

  const task = await CleaningTask.findOne({ id: cleaning_task_id }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  const created = await CleaningPhoto.create({
    cleaning_task_id,
    photo_url,
    photo_public_id: photo_public_id || null,
    type: normalizedType,
  });

  return serializeCleaningPhoto(created);
};

exports.getAllCleaningPhotos = async (query = {}) => {
  const filter = {};

  if (query.cleaning_task_id) filter.cleaning_task_id = query.cleaning_task_id;
  if (query.type) {
    const normalizedType = normalizeType(query.type);
    validateType(normalizedType);
    filter.type = normalizedType;
  }

  const photos = await CleaningPhoto.find(filter).sort({ created_at: -1 });
  return photos.map(serializeCleaningPhoto);
};

exports.getCleaningPhotoById = async (id) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);
  return serializeCleaningPhoto(photo);
};

exports.updateCleaningPhoto = async (id, data) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);

  const nextTaskId = data.cleaning_task_id !== undefined ? data.cleaning_task_id : photo.cleaning_task_id;
  const nextType = data.type !== undefined ? normalizeType(data.type) : photo.type;
  validateType(nextType);

  const incomingAsset = await resolvePhotoAsset({
    photo_url: data.photo_url,
    photo_public_id: data.photo_public_id,
    photo_buffer: data.photo_buffer,
    photo_mime_type: data.photo_mime_type,
  });

  const task = await CleaningTask.findOne({ id: nextTaskId }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  photo.cleaning_task_id = nextTaskId;
  const previousPublicId = photo.photo_public_id;
  const hasIncomingPhotoPayload =
    data.photo_url !== undefined ||
    data.photo_public_id !== undefined ||
    data.photo_buffer !== undefined;
  const nextPhotoPublicId = hasIncomingPhotoPayload
    ? incomingAsset.photo_public_id
    : photo.photo_public_id;
  const isReplacingCloudinaryAsset =
    hasIncomingPhotoPayload &&
    nextPhotoPublicId &&
    previousPublicId &&
    nextPhotoPublicId !== previousPublicId;

  photo.photo_url = data.photo_url !== undefined ? incomingAsset.photo_url : photo.photo_url;
  photo.photo_public_id = hasIncomingPhotoPayload ? nextPhotoPublicId : photo.photo_public_id;
  photo.type = nextType;

  await photo.save();

  if (isReplacingCloudinaryAsset) {
    await cloudinary.uploader.destroy(previousPublicId).catch(() => null);
  }

  return serializeCleaningPhoto(photo);
};

exports.deleteCleaningPhoto = async (id) => {
  const photo = await CleaningPhoto.findOne({ id });
  if (!photo) throw createError("Cleaning photo not found", 404);

  if (photo.photo_public_id) {
    await cloudinary.uploader.destroy(photo.photo_public_id).catch(() => null);
  }

  await CleaningPhoto.deleteOne({ id });
  return { message: "Cleaning photo deleted successfully" };
};
