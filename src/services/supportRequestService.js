const Booking = require("../models/Bookings");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const SupportRequest = require("../models/SupportRequest");

class SupportRequestService {
  async createSupportRequest(actor, payload = {}) {
    const actorId = String(actor?._id || actor?.id || "");
    if (!actorId) {
      const error = new Error("Unauthorized");
      error.statusCode = 401;
      throw error;
    }

    const { booking_id, type, description, images = [] } = payload;

    if (!booking_id || !type || !description) {
      const error = new Error("booking_id, type and description are required");
      error.statusCode = 400;
      throw error;
    }

    if (!Array.isArray(images)) {
      const error = new Error("images must be an array of URL strings");
      error.statusCode = 400;
      throw error;
    }

    const booking = await Booking.findOne({ id: booking_id }).select(
      "id user_id pod_id status start_time end_time"
    );

    if (!booking) {
      const error = new Error("Booking not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(booking.user_id) !== actorId) {
      const error = new Error("You can only create support requests for your own booking");
      error.statusCode = 403;
      throw error;
    }

    if (!["IN_USE", "COMPLETED"].includes(booking.status)) {
      const error = new Error("Support requests are only allowed for bookings that are in use or completed");
      error.statusCode = 400;
      throw error;
    }

    const pod = await Pod.findOne({ id: booking.pod_id }).select("id cluster_id");
    if (!pod) {
      const error = new Error("Pod not found for this booking");
      error.statusCode = 404;
      throw error;
    }

    const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id");
    if (!cluster) {
      const error = new Error("Pod cluster not found for this booking");
      error.statusCode = 404;
      throw error;
    }

    const supportRequest = await SupportRequest.create({
      booking_id,
      pod_id: booking.pod_id,
      location_id: cluster.location_id,
      user_id: actorId,
      type,
      description,
      images,
      status: "PENDING",
    });

    return supportRequest;
  }

  async getSupportRequests(actor, managerScope, filters = {}) {
    const role = String(actor?.role || "");
    const actorId = String(actor?._id || actor?.id || "");
    const { status, type, booking_id, page = 1, limit = 20 } = filters;

    const query = {};

    if (status) query.status = String(status).toUpperCase();
    if (type) query.type = String(type).toUpperCase();
    if (booking_id) query.booking_id = String(booking_id);

    if (role === "user") {
      query.user_id = actorId;
    } else if (role === "manager") {
      const locationIds = (managerScope && managerScope.locationIds) || [];
      query.location_id = { $in: locationIds.map((item) => String(item)) };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      SupportRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("booking", "id user_id pod_id status start_time end_time")
        .populate("handler", "_id name email role"),
      SupportRequest.countDocuments(query),
    ]);

    return {
      requests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    };
  }

  async updateSupportRequestStatus(requestId, actor, managerScope, payload = {}) {
    const actorId = String(actor?._id || actor?.id || "");
    const actorRole = String(actor?.role || "");
    const { status } = payload;

    if (actorRole !== "manager") {
      const error = new Error("Only manager can handle support request status");
      error.statusCode = 403;
      throw error;
    }

    if (!status) {
      const error = new Error("status is required");
      error.statusCode = 400;
      throw error;
    }

    const normalizedStatus = String(status).toUpperCase();
    if (!["PENDING", "IN_PROGRESS", "RESOLVED"].includes(normalizedStatus)) {
      const error = new Error("status must be one of PENDING, IN_PROGRESS, RESOLVED");
      error.statusCode = 400;
      throw error;
    }

    const supportRequest = await SupportRequest.findOne({ id: requestId });
    if (!supportRequest) {
      const error = new Error("Support request not found");
      error.statusCode = 404;
      throw error;
    }

    if (!supportRequest.location_id || !supportRequest.pod_id) {
      const booking = await Booking.findOne({ id: supportRequest.booking_id }).select("id pod_id");
      if (!booking) {
        const error = new Error("Booking not found for support request");
        error.statusCode = 404;
        throw error;
      }

      const pod = await Pod.findOne({ id: booking.pod_id }).select("id cluster_id");
      if (!pod) {
        const error = new Error("Pod not found for support request booking");
        error.statusCode = 404;
        throw error;
      }

      const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id");
      if (!cluster) {
        const error = new Error("Pod cluster not found for support request booking");
        error.statusCode = 404;
        throw error;
      }

      supportRequest.pod_id = booking.pod_id;
      supportRequest.location_id = cluster.location_id;
    }

    const locationIds = (managerScope && managerScope.locationIds) || [];
    const canAccess = locationIds.map((item) => String(item)).includes(String(supportRequest.location_id));
    if (!canAccess) {
      const error = new Error("You are not allowed to handle support requests outside your location scope");
      error.statusCode = 403;
      throw error;
    }

    if (normalizedStatus === "IN_PROGRESS" || normalizedStatus === "RESOLVED") {
      supportRequest.handled_by = actorId;
      supportRequest.handled_at = new Date();
    } else if (normalizedStatus === "PENDING") {
      supportRequest.handled_by = null;
      supportRequest.handled_at = null;
    }

    supportRequest.status = normalizedStatus;
    await supportRequest.save();

    return supportRequest;
  }
}

module.exports = new SupportRequestService();
