const CleaningMedia = require("../models/CleaningMedia");
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
const BASE64_VIDEO_DATA_URI_REGEX = /^data:(video\/[a-zA-Z0-9.+-]+);base64,/;
const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES_AFTER_PREPROCESS = 6 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const TARGET_LONG_EDGE = 1920;
const CLOUDINARY_UPLOAD_AGENT = new https.Agent({
  keepAlive: true,
  timeout: 300000,
});

const isBase64VideoDataUri = (value) => {
  if (!value || typeof value !== "string") return false;
  return BASE64_VIDEO_DATA_URI_REGEX.test(String(value).trim());
};

const isVideoMimeType = (mimeType) => {
  return String(mimeType || "").toLowerCase().startsWith("video/");
};

const resolveFileType = (mimeType, explicitFileType) => {
  if (explicitFileType) {
    const upper = String(explicitFileType).trim().toUpperCase();
    if (upper === "VIDEO" || upper === "IMAGE") return upper;
  }
  return isVideoMimeType(mimeType) ? "VIDEO" : "IMAGE";
};

const isBase64ImageDataUri = (value) => {
  if (!value || typeof value !== "string") return false;
  return BASE64_IMAGE_DATA_URI_REGEX.test(String(value).trim());
};

const isBase64MediaDataUri = (value) => {
  return isBase64ImageDataUri(value) || isBase64VideoDataUri(value);
};

const decodeBase64MediaDataUri = (dataUri) => {
  const trimmed = String(dataUri).trim();
  const imageMatch = trimmed.match(BASE64_IMAGE_DATA_URI_REGEX);
  const videoMatch = trimmed.match(BASE64_VIDEO_DATA_URI_REGEX);
  const matched = imageMatch || videoMatch;

  if (!matched) {
    throw createErrorWithCode("Invalid base64 media data", 400, "INVALID_BASE64_IMAGE_DATA");
  }

  const mimeType = matched[1];
  const base64Payload = trimmed.replace(matched[0], "");

  let buffer;
  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch (_) {
    throw createErrorWithCode("Invalid base64 media payload", 400, "INVALID_BASE64_IMAGE_DATA");
  }

  if (!buffer || buffer.length === 0) {
    throw createErrorWithCode("Media payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
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

const uploadImageBufferToCloudinary = async ({ buffer, mimeType }) => {
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
      media_url: uploaded?.secure_url || uploaded?.url || null,
      media_public_id: uploaded?.public_id || null,
      file_type: "IMAGE",
    };
  } catch (firstError) {
    const mapped = mapCloudinaryUploadError(firstError);
    const shouldRetry = mapped.errorCode === "CLOUDINARY_UPLOAD_TIMEOUT";
    if (!shouldRetry) throw mapped;

    try {
      const uploaded = await attemptUpload();
      return {
        media_url: uploaded?.secure_url || uploaded?.url || null,
        media_public_id: uploaded?.public_id || null,
        file_type: "IMAGE",
      };
    } catch (retryError) {
      throw mapCloudinaryUploadError(retryError);
    }
  }
};

const uploadVideoBufferToCloudinary = async ({ buffer, mimeType }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createErrorWithCode("Video payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
  }
  if (buffer.length > MAX_VIDEO_UPLOAD_BYTES) {
    throw createErrorWithCode("Video file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
  }

  const attemptUpload = () =>
    new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder: "oasisgo/cleaning-tasks",
          resource_type: "video",
          overwrite: false,
          timeout: 300000,
          agent: CLOUDINARY_UPLOAD_AGENT,
        },
        (error, result) => {
          if (error) return reject(error);
          return resolve(result);
        }
      );

      upload.on("error", reject);
      upload.end(buffer);
    });

  try {
    const uploaded = await attemptUpload();
    return {
      media_url: uploaded?.secure_url || uploaded?.url || null,
      media_public_id: uploaded?.public_id || null,
      file_type: "VIDEO",
    };
  } catch (firstError) {
    const mapped = mapCloudinaryUploadError(firstError);
    const shouldRetry = mapped.errorCode === "CLOUDINARY_UPLOAD_TIMEOUT";
    if (!shouldRetry) throw mapped;

    try {
      const uploaded = await attemptUpload();
      return {
        media_url: uploaded?.secure_url || uploaded?.url || null,
        media_public_id: uploaded?.public_id || null,
        file_type: "VIDEO",
      };
    } catch (retryError) {
      throw mapCloudinaryUploadError(retryError);
    }
  }
};

const resolveMediaAsset = async ({ media_url, media_public_id, media_buffer, media_mime_type, file_type }) => {
  const detectedFileType = resolveFileType(media_mime_type, file_type);

  if (media_buffer) {
    if (detectedFileType === "VIDEO") {
      return uploadVideoBufferToCloudinary({ buffer: media_buffer, mimeType: media_mime_type });
    }
    return uploadImageBufferToCloudinary({ buffer: media_buffer, mimeType: media_mime_type });
  }

  if (isBase64MediaDataUri(media_url)) {
    const decoded = decodeBase64MediaDataUri(media_url);
    if (isVideoMimeType(decoded.mimeType)) {
      return uploadVideoBufferToCloudinary({ buffer: decoded.buffer, mimeType: decoded.mimeType });
    }
    return uploadImageBufferToCloudinary({ buffer: decoded.buffer, mimeType: decoded.mimeType });
  }

  return {
    media_url,
    media_public_id,
    file_type: detectedFileType,
  };
};

const serializeCleaningMedia = (media) => {
  if (!media) return media;
  const raw = typeof media.toObject === "function" ? media.toObject() : { ...media };
  return {
    ...raw,
    media: {
      url: raw.media_url || null,
      public_id: raw.media_public_id || null,
      file_type: raw.file_type || "IMAGE",
    },
  };
};

const normalizeMediaType = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const validateMediaType = (value) => {
  const allowedTypes = ["BEFORE", "AFTER"];
  if (value && !allowedTypes.includes(value)) {
    throw createError(`Invalid media_type. Must be one of: ${allowedTypes.join(", ")}`, 400);
  }
};

exports.createCleaningMedia = async (data) => {
  const { cleaning_task_id, media_type } = data;
  const resolvedAsset = await resolveMediaAsset({
    media_url: data.media_url,
    media_public_id: data.media_public_id,
    media_buffer: data.media_buffer,
    media_mime_type: data.media_mime_type,
    file_type: data.file_type,
  });
  const { media_url, media_public_id, file_type } = resolvedAsset;

  if (!cleaning_task_id || !media_url || !media_type) {
    throw createError("cleaning_task_id, media_url and media_type are required", 400);
  }

  const normalizedMediaType = normalizeMediaType(media_type);
  validateMediaType(normalizedMediaType);

  const task = await CleaningTask.findOne({ id: cleaning_task_id }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  const created = await CleaningMedia.create({
    cleaning_task_id,
    media_url,
    media_public_id: media_public_id || null,
    media_type: normalizedMediaType,
    file_type: file_type || "IMAGE",
  });

  return serializeCleaningMedia(created);
};

exports.getAllCleaningMedia = async (query = {}) => {
  const filter = {};

  if (query.cleaning_task_id) filter.cleaning_task_id = query.cleaning_task_id;
  if (query.media_type) {
    const normalizedMediaType = normalizeMediaType(query.media_type);
    validateMediaType(normalizedMediaType);
    filter.media_type = normalizedMediaType;
  }
  if (query.file_type) {
    const upper = String(query.file_type).trim().toUpperCase();
    if (upper === "IMAGE" || upper === "VIDEO") filter.file_type = upper;
  }

  const mediaList = await CleaningMedia.find(filter).sort({ created_at: -1 });
  return mediaList.map(serializeCleaningMedia);
};

exports.getCleaningMediaById = async (id) => {
  const media = await CleaningMedia.findOne({ id });
  if (!media) throw createError("Cleaning media not found", 404);
  return serializeCleaningMedia(media);
};

exports.updateCleaningMedia = async (id, data) => {
  const media = await CleaningMedia.findOne({ id });
  if (!media) throw createError("Cleaning media not found", 404);

  const nextTaskId = data.cleaning_task_id !== undefined ? data.cleaning_task_id : media.cleaning_task_id;
  const nextMediaType = data.media_type !== undefined ? normalizeMediaType(data.media_type) : media.media_type;
  validateMediaType(nextMediaType);

  const incomingAsset = await resolveMediaAsset({
    media_url: data.media_url,
    media_public_id: data.media_public_id,
    media_buffer: data.media_buffer,
    media_mime_type: data.media_mime_type,
    file_type: data.file_type,
  });

  const task = await CleaningTask.findOne({ id: nextTaskId }).select("id").lean();
  if (!task) throw createError("Cleaning task not found", 404);

  const previousPublicId = media.media_public_id;
  const hasIncomingMediaPayload =
    data.media_url !== undefined ||
    data.media_public_id !== undefined ||
    data.media_buffer !== undefined;
  const nextMediaPublicId = hasIncomingMediaPayload
    ? incomingAsset.media_public_id
    : media.media_public_id;
  const isReplacingCloudinaryAsset =
    hasIncomingMediaPayload &&
    nextMediaPublicId &&
    previousPublicId &&
    nextMediaPublicId !== previousPublicId;

  media.cleaning_task_id = nextTaskId;
  media.media_url = hasIncomingMediaPayload ? incomingAsset.media_url : media.media_url;
  media.media_public_id = hasIncomingMediaPayload ? nextMediaPublicId : media.media_public_id;
  media.media_type = nextMediaType;
  if (hasIncomingMediaPayload && incomingAsset.file_type) {
    media.file_type = incomingAsset.file_type;
  }

  await media.save();

  if (isReplacingCloudinaryAsset) {
    const prevFileType = previousPublicId && previousPublicId.includes("/video/") ? "video" : "image";
    await cloudinary.uploader.destroy(previousPublicId, { resource_type: prevFileType }).catch(() => null);
  }

  return serializeCleaningMedia(media);
};

exports.deleteCleaningMedia = async (id) => {
  const media = await CleaningMedia.findOne({ id });
  if (!media) throw createError("Cleaning media not found", 404);

  if (media.media_public_id) {
    const resourceType = media.file_type === "VIDEO" ? "video" : "image";
    await cloudinary.uploader.destroy(media.media_public_id, { resource_type: resourceType }).catch(() => null);
  }

  await CleaningMedia.deleteOne({ id });
  return { message: "Cleaning media deleted successfully" };
};

// ── Backward-compat aliases (used by cleaningTaskService) ──────────────────
exports.createCleaningPhoto = exports.createCleaningMedia;
exports.getAllCleaningPhotos = exports.getAllCleaningMedia;
exports.getCleaningPhotoById = exports.getCleaningMediaById;
exports.updateCleaningPhoto = exports.updateCleaningMedia;
exports.deleteCleaningPhoto = exports.deleteCleaningMedia;
