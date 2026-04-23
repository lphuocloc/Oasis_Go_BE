const LostFoundItem = require("../models/LostFoundItem");
const LostFoundMedia = require("../models/LostFoundMedia");
const Pod = require("../models/Pod");
const Warehouse = require("../models/Warehouse");
const User = require("../models/User");
const { cloudinary } = require("../config/cloudinary");
const sharp = require("sharp");
const https = require("https");

const LOST_FOUND_STATUSES = ["FOUND", "CLAIMED", "DISPOSED", "RETURNED_TO_USER"];
const LOST_FOUND_STATUS_TRANSITIONS = {
  FOUND: ["CLAIMED", "DISPOSED", "RETURNED_TO_USER"],
  CLAIMED: ["RETURNED_TO_USER"],
  DISPOSED: [],
  RETURNED_TO_USER: [],
};

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeStatus = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim().toUpperCase();
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

// ── Media upload helpers ──────────────────────────────────────────────────────

const BASE64_IMAGE_DATA_URI_REGEX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/;
const BASE64_VIDEO_DATA_URI_REGEX = /^data:(video\/[a-zA-Z0-9.+-]+);base64,/;
const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES_AFTER_PREPROCESS = 6 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const TARGET_LONG_EDGE = 1920;
const CLOUDINARY_UPLOAD_AGENT = new https.Agent({ keepAlive: true, timeout: 300000 });

const createErrorWithCode = (message, statusCode, errorCode) => {
  const err = createError(message, statusCode);
  err.errorCode = errorCode;
  return err;
};

const isBase64ImageDataUri = (value) => {
  if (!value || typeof value !== "string") return false;
  return BASE64_IMAGE_DATA_URI_REGEX.test(String(value).trim());
};

const isBase64VideoDataUri = (value) => {
  if (!value || typeof value !== "string") return false;
  return BASE64_VIDEO_DATA_URI_REGEX.test(String(value).trim());
};

const isBase64MediaDataUri = (value) => isBase64ImageDataUri(value) || isBase64VideoDataUri(value);

const isVideoMimeType = (mimeType) => String(mimeType || "").toLowerCase().startsWith("video/");

const decodeBase64MediaDataUri = (dataUri) => {
  const trimmed = String(dataUri).trim();
  const imageMatch = trimmed.match(BASE64_IMAGE_DATA_URI_REGEX);
  const videoMatch = trimmed.match(BASE64_VIDEO_DATA_URI_REGEX);
  const matched = imageMatch || videoMatch;
  if (!matched) throw createErrorWithCode("Invalid base64 media data", 400, "INVALID_BASE64_IMAGE_DATA");
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
      .resize({ width: TARGET_LONG_EDGE, height: TARGET_LONG_EDGE, fit: "inside", withoutEnlargement: true });
    const convertedBuffer = shouldUseJpeg
      ? await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      : await image.webp({ quality: 82, effort: 4 }).toBuffer();
    const optimizedBuffer = convertedBuffer.length > 0 && convertedBuffer.length < buffer.length ? convertedBuffer : buffer;
    if (optimizedBuffer.length > MAX_IMAGE_BYTES_AFTER_PREPROCESS) {
      throw createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
    }
    return { buffer: optimizedBuffer, mimeType: shouldUseJpeg ? "image/jpeg" : "image/webp" };
  } catch (error) {
    if (error?.errorCode) throw error;
    if (buffer.length > MAX_IMAGE_BYTES_AFTER_PREPROCESS) {
      throw createErrorWithCode("Image file is too large", 413, "CLOUDINARY_FILE_TOO_LARGE");
    }
    return { buffer, mimeType: mimeType || "image/jpeg" };
  }
};

const mapCloudinaryUploadError = (error) => {
  const providerMessage = String(error?.error?.message || error?.message || "");
  const lower = providerMessage.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || error?.http_code === 499) {
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
  if (!Buffer.isBuffer(preprocessed.buffer) || preprocessed.buffer.length === 0) {
    throw createErrorWithCode("Image payload is empty", 400, "EMPTY_IMAGE_PAYLOAD");
  }
  const attemptUpload = () =>
    new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        { folder: "oasisgo/lost-found-media", resource_type: "image", overwrite: false, timeout: 180000, agent: CLOUDINARY_UPLOAD_AGENT },
        (error, result) => { if (error) return reject(error); return resolve(result); }
      );
      upload.on("error", reject);
      upload.end(preprocessed.buffer);
    });
  try {
    const uploaded = await attemptUpload();
    return { media_url: uploaded?.secure_url || uploaded?.url || null, media_public_id: uploaded?.public_id || null, file_type: "IMAGE" };
  } catch (firstError) {
    const mapped = mapCloudinaryUploadError(firstError);
    if (mapped.errorCode !== "CLOUDINARY_UPLOAD_TIMEOUT") throw mapped;
    try {
      const uploaded = await attemptUpload();
      return { media_url: uploaded?.secure_url || uploaded?.url || null, media_public_id: uploaded?.public_id || null, file_type: "IMAGE" };
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
        { folder: "oasisgo/lost-found-media", resource_type: "video", overwrite: false, timeout: 300000, agent: CLOUDINARY_UPLOAD_AGENT },
        (error, result) => { if (error) return reject(error); return resolve(result); }
      );
      upload.on("error", reject);
      upload.end(buffer);
    });
  try {
    const uploaded = await attemptUpload();
    return { media_url: uploaded?.secure_url || uploaded?.url || null, media_public_id: uploaded?.public_id || null, file_type: "VIDEO" };
  } catch (firstError) {
    const mapped = mapCloudinaryUploadError(firstError);
    if (mapped.errorCode !== "CLOUDINARY_UPLOAD_TIMEOUT") throw mapped;
    try {
      const uploaded = await attemptUpload();
      return { media_url: uploaded?.secure_url || uploaded?.url || null, media_public_id: uploaded?.public_id || null, file_type: "VIDEO" };
    } catch (retryError) {
      throw mapCloudinaryUploadError(retryError);
    }
  }
};

const resolveMediaAsset = async ({ media_url, media_buffer, media_mime_type, file_type }) => {
  const isVideo = file_type === "VIDEO" || isVideoMimeType(media_mime_type);

  if (media_buffer) {
    return isVideo
      ? uploadVideoBufferToCloudinary({ buffer: media_buffer, mimeType: media_mime_type })
      : uploadImageBufferToCloudinary({ buffer: media_buffer, mimeType: media_mime_type });
  }

  if (isBase64MediaDataUri(media_url)) {
    const decoded = decodeBase64MediaDataUri(media_url);
    return isVideoMimeType(decoded.mimeType)
      ? uploadVideoBufferToCloudinary({ buffer: decoded.buffer, mimeType: decoded.mimeType })
      : uploadImageBufferToCloudinary({ buffer: decoded.buffer, mimeType: decoded.mimeType });
  }

  return { media_url: media_url || null, media_public_id: null, file_type: isVideo ? "VIDEO" : "IMAGE" };
};

// ─────────────────────────────────────────────────────────────────────────────

const resolveActorIds = (actor) => [actor?.id, actor?._id].filter(Boolean).map((id) => String(id));

const populateLostFoundItem = async (item) => {
  const raw = typeof item.toObject === "function" ? item.toObject() : { ...item };

  const [pod, warehouse, foundByUser, claimedByUser, mediaList] = await Promise.all([
    raw.pod_id ? Pod.findOne({ id: raw.pod_id }).select("id name").lean() : null,
    raw.warehouse_id ? Warehouse.findOne({ id: raw.warehouse_id }).select("id name").lean() : null,
    raw.found_by_user_id ? User.findOne({ $or: [{ id: raw.found_by_user_id }, { _id: raw.found_by_user_id }] }).select("id name").lean() : null,
    raw.claimed_by_user_id ? User.findOne({ $or: [{ id: raw.claimed_by_user_id }, { _id: raw.claimed_by_user_id }] }).select("id name").lean() : null,
    LostFoundMedia.find({ lost_found_item_id: raw.id }).select("id media_url file_type created_at").lean(),
  ]);

  return {
    ...raw,
    pod_name: pod?.name || null,
    warehouse_name: warehouse?.name || null,
    found_by_user_name: foundByUser?.name || null,
    claimed_by_user_name: claimedByUser?.name || null,
    media: Array.isArray(mediaList) ? mediaList : [],
  };
};

const populateLostFoundItems = (items) => Promise.all(items.map(populateLostFoundItem));

const resolveCreateContext = async ({ pod_id, booking_id, warehouse_id }) => {
  if (pod_id) {
    const pod = await Pod.findOne({ id: pod_id }).select("id").lean();
    if (!pod) throw createError("Pod not found", 404);
  }

  if (warehouse_id) {
    const warehouse = await Warehouse.findOne({ id: warehouse_id }).select("id").lean();
    if (!warehouse) throw createError("Warehouse not found", 404);
  }

  return {
    pod_id: pod_id || null,
    booking_id: booking_id || null,
  };
};

exports.createLostFoundItem = async ({ pod_id, booking_id, item_name, description, media_url, media_buffer, media_mime_type, file_type, found_at, warehouse_id }, actor) => {
  const context = await resolveCreateContext({ pod_id, booking_id, warehouse_id });

  const normalizedItemName = String(item_name || "").trim();
  if (!normalizedItemName) throw createError("item_name is required", 400);
  const actorIds = resolveActorIds(actor);
  if (!actorIds[0]) throw createError("Unable to resolve finder identity", 401);

  const resolvedAsset = media_url || media_buffer
    ? await resolveMediaAsset({ media_url, media_buffer, media_mime_type, file_type })
    : null;

  const item = await LostFoundItem.create({
    pod_id: context.pod_id,
    booking_id: context.booking_id,
    found_by_user_id: actorIds[0],
    warehouse_id: warehouse_id || null,
    item_name: normalizedItemName,
    description: description ? String(description).trim() : null,
    found_at: found_at ? new Date(found_at) : new Date(),
    status: "FOUND",
  });

  if (resolvedAsset && resolvedAsset.media_url) {
    await LostFoundMedia.create({
      lost_found_item_id: item.id,
      media_url: resolvedAsset.media_url,
      media_public_id: resolvedAsset.media_public_id || null,
      file_type: resolvedAsset.file_type || "IMAGE",
    });
  }

  return populateLostFoundItem(item);
};

exports.getLostFoundItems = async (query = {}) => {
  const filter = {};
  const shouldPaginate = query.page !== undefined || query.limit !== undefined;

  if (query.pod_id) filter.pod_id = query.pod_id;
  if (query.booking_id) filter.booking_id = query.booking_id;
  if (query.found_by_user_id) filter.found_by_user_id = query.found_by_user_id;
  if (query.status) {
    const normalizedStatus = normalizeStatus(query.status);
    if (!LOST_FOUND_STATUSES.includes(normalizedStatus)) {
      throw createError(`Invalid status. Must be one of: ${LOST_FOUND_STATUSES.join(", ")}`, 400);
    }
    filter.status = normalizedStatus;
  }

  if (!shouldPaginate) {
    const items = await LostFoundItem.find(filter).sort({ created_at: -1 });
    return populateLostFoundItems(items);
  }

  const page = parsePositiveInt(query.page, 1);
  const requestedLimit = parsePositiveInt(query.limit, 20);
  const limit = Math.min(requestedLimit, 100);
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    LostFoundItem.countDocuments(filter),
    LostFoundItem.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
  ]);

  return {
    items: await populateLostFoundItems(items),
    pagination: {
      current_page: page,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      total_items: total,
      items_per_page: limit,
    },
  };
};

exports.getMyLostFoundItems = async (query = {}, actor) => {
  const actorIds = resolveActorIds(actor);
  if (!actorIds[0]) throw createError("Unable to resolve user identity", 401);
  return exports.getLostFoundItems({ ...query, found_by_user_id: actorIds[0] });
};

exports.getLostFoundItemById = async (id) => {
  const item = await LostFoundItem.findOne({ id });
  if (!item) throw createError("Lost & found item not found", 404);
  return populateLostFoundItem(item);
};

exports.updateLostFoundStatus = async (id, status, actor) => {
  const normalizedStatus = normalizeStatus(status);
  if (!LOST_FOUND_STATUSES.includes(normalizedStatus)) {
    throw createError(`Invalid status. Must be one of: ${LOST_FOUND_STATUSES.join(", ")}`, 400);
  }

  const item = await LostFoundItem.findOne({ id });
  if (!item) throw createError("Lost & found item not found", 404);

  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = resolveActorIds(actor);
  const isFinder = actorIds.includes(String(item.found_by_user_id));

  if (actorRole === "cleaner" && !isFinder) {
    throw createError("You are not allowed to update this lost & found item", 403);
  }

  const currentStatus = normalizeStatus(item.status);
  const allowedNextStatuses = LOST_FOUND_STATUS_TRANSITIONS[currentStatus] || [];
  const isSameStatus = currentStatus === normalizedStatus;

  if (!isSameStatus && !allowedNextStatuses.includes(normalizedStatus)) {
    throw createError(`Invalid status transition from ${currentStatus} to ${normalizedStatus}`, 400);
  }

  item.status = normalizedStatus;

  if (normalizedStatus === "CLAIMED" || normalizedStatus === "RETURNED_TO_USER") {
    item.claimed_by_user_id = actorIds[0] || item.claimed_by_user_id || null;
    item.claimed_at = item.claimed_at || new Date();
  }

  await item.save();
  return populateLostFoundItem(item);
};
