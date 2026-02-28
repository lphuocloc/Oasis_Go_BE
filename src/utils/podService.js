const mongoose = require("mongoose");
const Pod = require("../models/pod.model");

/**
 * Validate ObjectId
 */
const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

/**
 * Build query filter cho Pod
 * (KHÔNG quan tâm role)
 */
const buildPodFilter = (filters = {}) => {
  const query = {};

  if (filters.locationId) {
    if (!isValidObjectId(filters.locationId)) {
      throw new Error("Invalid locationId");
    }
    query.location = filters.locationId;
  }

  if (filters.clusterId) {
    if (!isValidObjectId(filters.clusterId)) {
      throw new Error("Invalid clusterId");
    }
    query.cluster = filters.clusterId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  return query;
};

//////////////////////////////
// READ
//////////////////////////////

/**
 * Get all pods (generic)
 * dùng cho staff, admin, dashboard
 */
exports.getPods = async (filters = {}) => {
  const query = buildPodFilter(filters);

  return Pod.find(query)
    .populate("cluster", "name")
    .populate("location", "name")
    .sort({ createdAt: -1 });
};

/**
 * Get available pods only
 * dùng cho customer booking
 */
exports.getAvailablePods = async (filters = {}) => {
  return exports.getPods({
    ...filters,
    status: "AVAILABLE"
  });
};

/**
 * Get pod detail
 */
exports.getPodById = async (podId) => {
  if (!isValidObjectId(podId)) {
    throw new Error("Invalid podId");
  }

  const pod = await Pod.findById(podId)
    .populate("cluster")
    .populate("location");

  if (!pod) {
    throw new Error("Pod not found");
  }

  return pod;
};

//////////////////////////////
// WRITE
//////////////////////////////

/**
 * Update pod status
 * (cleaning / maintenance / system)
 */
exports.updatePodStatus = async (podId, status) => {
  if (!isValidObjectId(podId)) {
    throw new Error("Invalid podId");
  }

  const allowedStatus = [
    "AVAILABLE",
    "OCCUPIED",
    "NEEDS_CLEANING",
    "CLEANING",
    "MAINTENANCE",
    "OUT_OF_SERVICE"
  ];

  if (!allowedStatus.includes(status)) {
    throw new Error("Invalid pod status");
  }

  const pod = await Pod.findByIdAndUpdate(
    podId,
    { status },
    { new: true }
  );

  if (!pod) {
    throw new Error("Pod not found");
  }

  return pod;
};

/**
 * Check pod availability
 * dùng cho booking service
 */
exports.isPodAvailable = async (podId) => {
  if (!isValidObjectId(podId)) {
    throw new Error("Invalid podId");
  }

  const pod = await Pod.findById(podId);

  if (!pod) {
    throw new Error("Pod not found");
  }

  return pod.status === "AVAILABLE";
};