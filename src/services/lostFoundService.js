const LostFoundItem = require("../models/LostFoundItem");
const LostFoundMedia = require("../models/LostFoundMedia");
const LostItemRequest = require("../models/LostItemRequest");
const CleaningTask = require("../models/CleaningTask");
const Booking = require("../models/Bookings");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const LocationWarehouse = require("../models/LocationWarehouse");
const Warehouse = require("../models/Warehouse");
const User = require("../models/User");
const notificationService = require("./notificationService");
const crypto = require("crypto");

const LOST_FOUND_STATUSES = ["FOUND", "IN_STORAGE", "CLAIM_PENDING", "RETURNED", "DISPOSED"];
const LOST_ITEM_REQUEST_STATUSES = ["PENDING", "MATCHED", "CLOSED", "REJECTED"];

// ─── Helpers ──────────────────────────────────────────────────────

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const resolveActorId = (actor) => {
  const ids = [actor?.id, actor?._id].filter(Boolean).map(String);
  return ids.length > 0 ? ids[0] : null;
};

const resolveActorIdentityIds = (actor) => {
  return [...new Set([actor?.id, actor?._id].filter(Boolean).map(String))];
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeId = (value) => (value ? String(value) : null);

const buildUserMapByIds = async (userIds = []) => {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return {};

  const users = await User.find({ _id: { $in: ids } })
    .select("name phone email")
    .lean();

  return users.reduce((map, user) => {
    const id = String(user._id);
    map[id] = {
      id,
      name: user.name || null,
      phone: user.phone || null,
      email: user.email || null,
    };
    return map;
  }, {});
};

const buildBookingUserMap = async (bookingIds = []) => {
  const ids = [...new Set(bookingIds.filter(Boolean).map(String))];
  if (!ids.length) return {};

  const bookings = await Booking.find({ id: { $in: ids } })
    .select("id user_id")
    .lean();

  const userIds = bookings.map((b) => b.user_id).filter(Boolean).map(String);
  const userMap = await buildUserMapByIds(userIds);

  return bookings.reduce((map, booking) => {
    const bookingId = String(booking.id);
    const userId = normalizeId(booking.user_id);
    map[bookingId] = userId ? userMap[userId] || null : null;
    return map;
  }, {});
};

/**
 * Lấy cleaning_task_ids từ booking_id của các LostFoundItem.
 */
const buildCleaningTaskMap = async (bookingIds = []) => {
  const ids = bookingIds.filter(Boolean);
  if (!ids.length) return {};
  const tasks = await CleaningTask.find({ booking_id: { $in: ids } })
    .select("booking_id id")
    .lean();
  return tasks.reduce((map, t) => {
    if (!map[t.booking_id]) map[t.booking_id] = [];
    map[t.booking_id].push(t.id);
    return map;
  }, {});
};

/**
 * Lấy ảnh của LostFoundItem theo item_id, trả về array media_url.
 */
const buildMediaMap = async (itemIds = []) => {
  if (!itemIds.length) return {};
  const mediaList = await LostFoundMedia.find({
    lost_found_item_id: { $in: itemIds },
  })
    .select("lost_found_item_id media_url")
    .lean();

  return mediaList.reduce((map, m) => {
    if (!map[m.lost_found_item_id]) map[m.lost_found_item_id] = [];
    map[m.lost_found_item_id].push(m.media_url);
    return map;
  }, {});
};

/**
 * Tìm booking COMPLETED hoặc IN_USE gần nhất của pod (không giới hạn thời gian).
 */
const findLatestBookingForPod = async (podId) => {
  const booking = await Booking.findOne({
    pod_id: podId,
    status: { $in: ["COMPLETED", "IN_USE"] },
  })
    .sort({ end_time: -1 })
    .select("id user_id pod_id status end_time")
    .lean();
  return booking || null;
};

/**
 * Lấy warehouse_id từ location của pod (qua cluster → LocationWarehouse).
 * Trả về warehouse_id đầu tiên tìm thấy, hoặc null.
 */
const resolveWarehouseForPod = async (podId) => {
  const pod = await Pod.findOne({ id: podId }).select("cluster_id").lean();
  if (!pod) return null;

  const cluster = await PodCluster.findOne({ id: pod.cluster_id })
    .select("location_id")
    .lean();
  if (!cluster?.location_id) return null;

  const locationWarehouse = await LocationWarehouse.findOne({
    location_id: cluster.location_id,
  })
    .select("warehouse_id")
    .lean();
  return locationWarehouse?.warehouse_id || null;
};

// ─── View mappers ─────────────────────────────────────────────────

const toLostFoundItemView = (item, mediaUrls = [], cleaningTaskIds = []) => {
  const doc = typeof item.toObject === "function" ? item.toObject() : item;
  return {
    ...doc,
    // Ẩn OTP khỏi response thông thường
    handover_otp: undefined,
    photo_urls: mediaUrls,
    cleaning_task_ids: cleaningTaskIds,
  };
};

// ─── Luồng Cleaner: Báo cáo tìm thấy đồ ─────────────────────────

/**
 * API 1 (Cleaner/Manager): Báo cáo tìm thấy đồ thất lạc tại Pod.
 *
 * - Tự động liên kết booking gần nhất của Pod.
 * - Tự động lấy warehouse tại location.
 * - serial_number do schema tự tạo.
 */
exports.reportFoundItem = async (
  { pod_id, item_name, description, found_at, uploaded_photos = [] },
  actor
) => {
  const reporterId = resolveActorId(actor);
  if (!reporterId) throw createError("Unable to resolve reporter identity", 401);

  if (!pod_id) throw createError("pod_id is required", 400);
  if (!item_name?.trim()) throw createError("item_name is required", 400);

  const pod = await Pod.findOne({ id: pod_id }).select("id code name cluster_id").lean();
  if (!pod) throw createError("Pod not found", 404);

  const [latestBooking, warehouseId] = await Promise.all([
    findLatestBookingForPod(pod_id),
    resolveWarehouseForPod(pod_id),
  ]);

  const item = await LostFoundItem.create({
    pod_id,
    booking_id: latestBooking?.id || null,
    found_by_user_id: reporterId,
    warehouse_id: warehouseId,
    item_name: item_name.trim(),
    description: description ? String(description).trim() : null,
    found_at: found_at ? new Date(found_at) : new Date(),
    status: "FOUND",
  });

  // Lưu ảnh nếu có
  if (uploaded_photos.length > 0) {
    const mediaRecords = uploaded_photos
      .filter((p) => p?.url)
      .map((p) => ({
        lost_found_item_id: item.id,
        media_url: p.url,
        media_public_id: p.public_id || null,
        file_type: p.file_type === "VIDEO" ? "VIDEO" : "IMAGE",
      }));
    if (mediaRecords.length) await LostFoundMedia.insertMany(mediaRecords);
  }

  const mediaUrls = uploaded_photos.filter((p) => p?.url).map((p) => p.url);

  return toLostFoundItemView(item.toObject(), mediaUrls);
};

// ─── Luồng Manager: Cất đồ vào kho ──────────────────────────────

/**
 * API 2 (Manager): Cập nhật trạng thái đồ → IN_STORAGE, ghi nhận warehouse.
 */
exports.storeToWarehouse = async (itemId, { warehouse_id }, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Only managers can store items", 403);
  }

  const item = await LostFoundItem.findOne({ id: itemId });
  if (!item) throw createError("Lost & Found item not found", 404);

  if (item.status !== "FOUND") {
    throw createError(`Cannot store item with status: ${item.status}`, 400);
  }

  if (!warehouse_id) throw createError("warehouse_id is required", 400);
  const warehouse = await Warehouse.findOne({ id: warehouse_id }).lean();
  if (!warehouse) throw createError("Warehouse not found", 404);

  item.warehouse_id = warehouse_id;
  item.status = "IN_STORAGE";
  await item.save();

  const mediaUrls = await LostFoundMedia.find({ lost_found_item_id: item.id })
    .select("media_url")
    .lean()
    .then((r) => r.map((m) => m.media_url));

  return toLostFoundItemView(item.toObject(), mediaUrls);
};

// ─── Luồng User: Gửi yêu cầu tìm đồ ────────────────────────────

/**
 * API 3 (User): Tạo yêu cầu tìm đồ thất lạc.
 */
exports.submitLostItemRequest = async (
  { booking_id, item_name_reported, description_reported },
  actor
) => {
  const userId = resolveActorId(actor);
  if (!userId) throw createError("Không thể xác định danh tính", 401);

  if (!item_name_reported?.trim()) throw createError("item_name_reported is required", 400);

  if (!booking_id) throw createError("booking_id is required", 400);

  // Kiểm tra booking thuộc về user này
  const booking = await Booking.findOne({ id: booking_id }).select("id user_id").lean();
  if (!booking) throw createError("Booking not found", 404);

  const bookingUserIds = [booking.user_id].filter(Boolean).map(String);
  const actorIds = resolveActorIdentityIds(actor);
  const isOwner = actorIds.some((id) => bookingUserIds.includes(id));
  if (!isOwner) throw createError("You can only request for your own bookings", 403);

  // Khách hàng không thể gửi thêm yêu cầu nếu trước đó đã có yêu cầu bị từ chối ở booking này
  const rejectedRequest = await LostItemRequest.findOne({
    booking_id: booking_id,
    user_id: userId,
    status: "REJECTED"
  }).lean();

  if (rejectedRequest) {
    throw createError("Yêu cầu tìm đồ trước đó của bạn ở Booking này đã bị từ chối, không thể gửi thêm yêu cầu mới.", 403);
  }

  const request = await LostItemRequest.create({
    user_id: userId,
    booking_id: booking_id || null,
    item_name_reported: item_name_reported.trim(),
    description_reported: description_reported ? String(description_reported).trim() : null,
    status: "PENDING",
  });

  return request.toObject();
};

// ─── Luồng Manager: Xét duyệt khớp ──────────────────────────────

/**
 * API 4 (Manager): Xác nhận khớp giữa LostItemRequest và LostFoundItem.
 * - LostItemRequest.status → MATCHED
 * - LostFoundItem.status → CLAIM_PENDING
 */
exports.confirmMatch = async (requestId, { found_item_id, manager_note }, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Only managers can confirm match", 403);
  }

  if (!found_item_id) throw createError("found_item_id is required", 400);

  const [request, foundItem] = await Promise.all([
    LostItemRequest.findOne({ id: requestId }),
    LostFoundItem.findOne({ id: found_item_id }),
  ]);

  if (!request) throw createError("Lost item request not found", 404);
  if (!foundItem) throw createError("Lost & Found item not found", 404);

  if (request.status !== "PENDING") {
    throw createError(`Request is already ${request.status}`, 400);
  }
  if (!["FOUND", "IN_STORAGE"].includes(foundItem.status)) {
    throw createError(`Item cannot be matched from status: ${foundItem.status}`, 400);
  }

  request.status = "MATCHED";
  request.matched_found_item_id = found_item_id;
  request.manager_note = manager_note ? String(manager_note).trim() : null;
  await request.save();

  foundItem.status = "CLAIM_PENDING";
  foundItem.claimed_by_user_id = request.user_id;
  await foundItem.save();

  return {
    request: request.toObject(),
    found_item: toLostFoundItemView(foundItem.toObject()),
  };
};

/**
 * API 4b (Manager): Từ chối yêu cầu tìm đồ.
 */
exports.rejectLostItemRequest = async (requestId, { manager_note }, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Only managers can reject requests", 403);
  }

  const request = await LostItemRequest.findOne({ id: requestId });
  if (!request) throw createError("Lost item request not found", 404);

  if (request.status !== "PENDING") {
    throw createError(`Request is already ${request.status}`, 400);
  }

  request.status = "REJECTED";
  request.manager_note = manager_note ? String(manager_note).trim() : null;
  await request.save();

  return request.toObject();
};

/**
 * API 4c (Manager): Đóng request thủ công (chỉ PENDING).
 */
exports.closeLostItemRequest = async (requestId, { manager_note }, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Chỉ managers và admin có thể đóng yêu cầu", 403);
  }

  const request = await LostItemRequest.findOne({ id: requestId });
  if (!request) throw createError("Yêu cầu tìm đồ không tồn tại", 404);

  if (request.status !== "PENDING") {
    throw createError(`Yêu cầu đã ở trạng thái ${request.status}, không thể đóng`, 400);
  }

  request.status = "CLOSED";
  request.manager_note = manager_note ? String(manager_note).trim() : null;
  await request.save();

  return request.toObject();
};

// ─── Luồng Handover: Bàn giao đồ ────────────────────────────────

/**
 * API 5 (Manager): Tạo OTP bàn giao, gửi Notification cho User.
 */
exports.generateHandoverOTP = async (itemId, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Only managers can generate OTP", 403);
  }

  const item = await LostFoundItem.findOne({ id: itemId });
  if (!item) throw createError("Đồ thất lạc không tồn tại", 404);

  if (item.status !== "CLAIM_PENDING") {
    throw createError(`Đồ phải ở trạng thái CLAIM_PENDING, hiện tại: ${item.status}`, 400);
  }
  if (!item.claimed_by_user_id) {
    throw createError("Đồ không có người nhận. Vui lòng xác nhận khớp trước.", 400);
  }

  // Tạo OTP 6 chữ số, hết hạn sau 15 phút
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  item.handover_otp = otp;
  item.handover_otp_expires_at = expiresAt;
  await item.save();

  // Gửi OTP qua Notification cho User (Sửa tham số và dùng notifyUser để gửi thật)
  try {
    await notificationService.sendToUser(item.claimed_by_user_id, {
      title: "Mã xác nhận nhận đồ thất lạc",
      message: `Mã OTP để nhận lại "${item.item_name}" của bạn là: ${otp}. Mã hết hạn sau 15 phút.`,
      type: "SUPPORT",
      data: {
        reference_id: item.id,
        reference_type: "LostFoundItem",
      }
    });
  } catch (notifErr) {
    console.error("[lostFoundService] Failed to send OTP notification:", notifErr.message);
  }

  return {
    success: true,
    message: "OTP generated and sent to user",
    item_id: item.id,
    item_name: item.item_name,
    otp: otp, // Trả về để Manager/Dev có thể xem trong Network tab để test
    otp_expires_at: expiresAt,
  };
};

/**
 * API 6 (Manager): Xác nhận OTP — hoàn tất bàn giao.
 * - Kiểm tra OTP + thời hạn.
 * - LostFoundItem.status → RETURNED.
 * - LostItemRequest.status → CLOSED.
 */
exports.confirmHandover = async (itemId, { otp }, actor) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  if (!["manager", "admin"].includes(actorRole)) {
    throw createError("Only managers can confirm handover", 403);
  }

  if (!otp) throw createError("otp is required", 400);

  const item = await LostFoundItem.findOne({ id: itemId });
  if (!item) throw createError("Lost & Found item not found", 404);

  if (item.status !== "CLAIM_PENDING") {
    throw createError(`Item must be in CLAIM_PENDING status, current: ${item.status}`, 400);
  }

  if (!item.handover_otp) {
    throw createError("No OTP generated for this item. Please generate OTP first.", 400);
  }

  if (String(item.handover_otp) !== String(otp).trim()) {
    throw createError("Invalid OTP", 400);
  }

  if (item.handover_otp_expires_at && new Date() > item.handover_otp_expires_at) {
    throw createError("OTP has expired. Please generate a new one.", 400);
  }

  item.status = "RETURNED";
  item.claimed_at = new Date();
  item.handover_otp = null;
  item.handover_otp_expires_at = null;
  await item.save();

  // Đóng LostItemRequest liên quan
  await LostItemRequest.updateMany(
    { matched_found_item_id: item.id, status: "MATCHED" },
    { $set: { status: "CLOSED" } }
  );

  return toLostFoundItemView(item.toObject());
};

// ─── GET APIs ────────────────────────────────────────────────────

/**
 * Lấy danh sách LostFoundItem có filter + pagination.
 */
exports.getLostFoundItems = async (filters = {}, actor = null) => {
  const query = {};

  if (filters.pod_id) query.pod_id = filters.pod_id;
  if (filters.booking_id) query.booking_id = filters.booking_id;
  if (filters.found_by_user_id) query.found_by_user_id = filters.found_by_user_id;
  if (filters.warehouse_id) query.warehouse_id = filters.warehouse_id;
  if (filters.serial_number) query.serial_number = filters.serial_number;

  if (filters.status) {
    const status = String(filters.status).toUpperCase();
    if (!LOST_FOUND_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${LOST_FOUND_STATUSES.join(", ")}`, 400);
    }
    query.status = status;
  }

  const shouldPaginate = filters.page !== undefined || filters.limit !== undefined;
  if (!shouldPaginate) {
    const items = await LostFoundItem.find(query).sort({ created_at: -1 }).lean();
    const itemIds = items.map((i) => i.id);
    const bookingIds = items.map((i) => i.booking_id);
    const [mediaMap, cleaningTaskMap, bookingUserMap] = await Promise.all([
      buildMediaMap(itemIds),
      buildCleaningTaskMap(bookingIds),
      buildBookingUserMap(bookingIds),
    ]);
    return {
      items: items.map((item) => {
        const view = toLostFoundItemView(
          item,
          mediaMap[item.id] || [],
          cleaningTaskMap[item.booking_id] || [],
        );
        return {
          ...view,
          booking_user: bookingUserMap[item.booking_id] || null,
        };
      }),
      pagination: null,
    };
  }

  const page = parsePositiveInt(filters.page, 1);
  const limit = Math.min(parsePositiveInt(filters.limit, 20), 100);
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    LostFoundItem.countDocuments(query),
    LostFoundItem.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const itemIds = items.map((i) => i.id);
  const bookingIds = items.map((i) => i.booking_id);
  const [mediaMap, cleaningTaskMap, bookingUserMap] = await Promise.all([
    buildMediaMap(itemIds),
    buildCleaningTaskMap(bookingIds),
    buildBookingUserMap(bookingIds),
  ]);

  return {
    items: items.map((item) => {
      const view = toLostFoundItemView(
        item,
        mediaMap[item.id] || [],
        cleaningTaskMap[item.booking_id] || [],
      );
      return {
        ...view,
        booking_user: bookingUserMap[item.booking_id] || null,
      };
    }),
    pagination: {
      current_page: page,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      total_items: total,
      items_per_page: limit,
    },
  };
};

/**
 * Lấy chi tiết 1 LostFoundItem.
 */
exports.getLostFoundItemById = async (itemId, actor = null) => {
  const item = await LostFoundItem.findOne({ id: itemId }).lean();
  if (!item) throw createError("Lost & Found item not found", 404);

  const [mediaUrls, cleaningTaskIds] = await Promise.all([
    LostFoundMedia.find({ lost_found_item_id: itemId })
      .select("media_url")
      .lean()
      .then((r) => r.map((m) => m.media_url)),
    item.booking_id
      ? CleaningTask.find({ booking_id: item.booking_id }).select("id").lean().then((r) => r.map((t) => t.id))
      : Promise.resolve([]),
  ]);

  return toLostFoundItemView(item, mediaUrls, cleaningTaskIds);
};

/**
 * Lấy danh sách LostItemRequest (Manager xem tất cả / User xem của mình).
 */
exports.getLostItemRequests = async (filters = {}, actor = null) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = resolveActorIdentityIds(actor);
  const query = {};

  // User chỉ xem được request của mình
  if (actorRole === "user") {
    query.user_id = actorIds.length === 1 ? actorIds[0] : { $in: actorIds };
  }

  if (filters.status) {
    const status = String(filters.status).toUpperCase();
    if (!LOST_ITEM_REQUEST_STATUSES.includes(status)) {
      throw createError(`Invalid status. Must be one of: ${LOST_ITEM_REQUEST_STATUSES.join(", ")}`, 400);
    }
    query.status = status;
  }
  if (filters.user_id && ["manager", "admin"].includes(actorRole)) {
    query.user_id = filters.user_id;
  }

  const shouldPaginate = filters.page !== undefined || filters.limit !== undefined;
  if (!shouldPaginate) {
    const requests = await LostItemRequest.find(query).sort({ created_at: -1 }).lean();
    const userMap = await buildUserMapByIds(requests.map((r) => r.user_id));
    return {
      items: requests.map((request) => ({
        ...request,
        user: userMap[normalizeId(request.user_id)] || null,
      })),
      pagination: null,
    };
  }

  const page = parsePositiveInt(filters.page, 1);
  const limit = Math.min(parsePositiveInt(filters.limit, 20), 100);
  const skip = (page - 1) * limit;

  const [total, requests] = await Promise.all([
    LostItemRequest.countDocuments(query),
    LostItemRequest.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const userMap = await buildUserMapByIds(requests.map((r) => r.user_id));

  return {
    items: requests.map((request) => ({
      ...request,
      user: userMap[normalizeId(request.user_id)] || null,
    })),
    pagination: {
      current_page: page,
      total_pages: total > 0 ? Math.ceil(total / limit) : 0,
      total_items: total,
      items_per_page: limit,
    },
  };
};

/**
 * Lấy chi tiết 1 LostItemRequest.
 */
exports.getLostItemRequestById = async (requestId, actor = null) => {
  const actorRole = String(actor?.role || "").toLowerCase();
  const actorIds = resolveActorIdentityIds(actor);

  const request = await LostItemRequest.findOne({ id: requestId }).lean();
  if (!request) throw createError("Lost item request not found", 404);

  if (actorRole === "user") {
    const isOwner = actorIds.includes(String(request.user_id || ""));
    if (!isOwner) throw createError("You are not allowed to access this request", 403);
  }

  const userMap = await buildUserMapByIds([request.user_id]);

  return {
    ...request,
    user: userMap[normalizeId(request.user_id)] || null,
  };
};
