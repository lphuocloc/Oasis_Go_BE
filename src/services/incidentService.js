const mongoose = require("mongoose");
const Incident = require("../models/Incidents");
const Pod = require("../models/Pod");

class IncidentService {
  /**
   * Helper to validate ObjectId
   */
  isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }

  /**
   * Get incidents with filters
   * Used for staff dashboard
   */
  async getIncidents(filters = {}) {
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
  }

  /**
   * Get incident detail by ID
   */
  async getIncidentById(incidentId) {
    if (!this.isValidObjectId(incidentId)) {
      throw new Error("Invalid incidentId");
    }

    const incident = await Incident.findById(incidentId)
      .populate("pod")
      .populate("reportedBy");

    if (!incident) {
      throw new Error("Incident not found");
    }

    return incident;
  }

  /**
   * Report incident
   * Used by customer or staff
   */
  async createIncident({ podId, reportedBy, description, severity }) {
    if (!this.isValidObjectId(podId) || !this.isValidObjectId(reportedBy)) {
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
      status: "PENDING",
    });

    // If high severity incident → mark pod as out of service
    if (severity === "HIGH") {
      pod.status = "OUT_OF_SERVICE";
      await pod.save();
    }

    return incident;
  }

  /**
   * Update incident status
   * Staff handles this
   */
  async updateIncidentStatus(incidentId, status) {
    const allowedStatus = ["PENDING", "INVESTIGATING", "RESOLVED", "CLOSED"];

    if (!allowedStatus.includes(status)) {
      throw new Error("Invalid incident status");
    }

    const incident = await this.getIncidentById(incidentId);

    incident.status = status;
    await incident.save();

    return incident;
  }
}

module.exports = new IncidentService();