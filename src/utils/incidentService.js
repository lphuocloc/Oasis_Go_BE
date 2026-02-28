const mongoose = require("mongoose");
const Incident = require("../models/incident.model");
const Pod = require("../models/pod.model");

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

//////////////////////////////
// READ
//////////////////////////////

/**
 * Get incidents
 * dùng cho staff dashboard
 */
exports.getIncidents = async (filters = {}) => {
  const query = {};

  if (filters.locationId) {
    query.location = filters.locationId;
  }

  if (filters.podId) {
    query.pod = filters.podId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  return Incident.find(query)
    .populate("pod", "code name")
    .populate("reportedBy", "name role")
    .sort({ createdAt: -1 });
};

/**
 * Get incident detail
 */
exports.getIncidentById = async (incidentId) => {
  if (!isValidObjectId(incidentId)) {
    throw new Error("Invalid incidentId");
  }

  const incident = await Incident.findById(incidentId)
    .populate("pod")
    .populate("reportedBy");

  if (!incident) {
    throw new Error("Incident not found");
  }

  return incident;
};

//////////////////////////////
// WRITE
//////////////////////////////

/**
 * Report incident
 * dùng cho customer hoặc staff
 */
exports.createIncident = async ({
  podId,
  reportedBy,
  description,
  severity
}) => {
  if (
    !isValidObjectId(podId) ||
    !isValidObjectId(reportedBy)
  ) {
    throw new Error("Invalid input");
  }

  const pod = await Pod.findById(podId);
  if (!pod) {
    throw new Error("Pod not found");
  }

  const incident = await Incident.create({
    pod: podId,
    location: pod.location,
    reportedBy,
    description,
    severity,
    status: "PENDING"
  });

  // Nếu incident nặng → out of service
  if (severity === "HIGH") {
    pod.status = "OUT_OF_SERVICE";
    await pod.save();
  }

  return incident;
};

/**
 * Update incident status
 * staff xử lý
 */
exports.updateIncidentStatus = async (
  incidentId,
  status
) => {
  const allowedStatus = [
    "PENDING",
    "INVESTIGATING",
    "RESOLVED",
    "CLOSED"
  ];

  if (!allowedStatus.includes(status)) {
    throw new Error("Invalid incident status");
  }

  const incident = await exports.getIncidentById(
    incidentId
  );

  incident.status = status;
  await incident.save();

  return incident;
};