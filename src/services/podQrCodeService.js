const { randomBytes } = require("crypto");
const PodQrCode = require("../models/PodQrCode");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");

const createToken = () => randomBytes(16).toString("hex");

class PodQrCodeService {
  async generateQrCodesByPodCluster(clusterId, options = {}) {
    if (!clusterId) {
      const error = new Error("cluster_id is required");
      error.statusCode = 400;
      throw error;
    }

    const cluster = await PodCluster.findOne({ id: clusterId });
    if (!cluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    const pods = await Pod.find({ cluster_id: clusterId }).sort({ code: 1, createdAt: 1 });
    if (pods.length === 0) {
      const error = new Error("No pods found in this cluster");
      error.statusCode = 404;
      throw error;
    }

    const now = Date.now();
    const fallbackExpiresAt = new Date(now + 30 * 60 * 1000);
    const expiresAt = options.expires_at ? new Date(options.expires_at) : fallbackExpiresAt;

    if (Number.isNaN(expiresAt.getTime())) {
      const error = new Error("expires_at is invalid");
      error.statusCode = 400;
      throw error;
    }

    if (expiresAt.getTime() <= now) {
      const error = new Error("expires_at must be in the future");
      error.statusCode = 400;
      throw error;
    }

    const isActive = options.is_active !== undefined ? options.is_active : true;
    const deactivateExisting = options.deactivate_existing !== false;
    const podIds = pods.map((pod) => pod.id);

    if (isActive && deactivateExisting) {
      await PodQrCode.updateMany({ pod_id: { $in: podIds }, is_active: true }, { $set: { is_active: false } });
    }

    const docsToCreate = pods.map((pod) => ({
      pod_id: pod.id,
      qr_token: `${pod.code}-${createToken()}`.toUpperCase(),
      expires_at: expiresAt,
      is_active: isActive,
    }));

    const createdQrCodes = await PodQrCode.insertMany(docsToCreate, { ordered: true });

    return {
      cluster_id: cluster.id,
      cluster_name: cluster.name,
      total_pods: pods.length,
      created_count: createdQrCodes.length,
      expires_at: expiresAt,
      is_active: isActive,
      deactivate_existing: deactivateExisting,
      created_qr_codes: createdQrCodes,
    };
  }

  async createQrCode(data) {
    const { pod_id, qr_token, expires_at, is_active } = data;

    const pod = await Pod.findOne({ id: pod_id });
    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    if (!expires_at) {
      const error = new Error("expires_at is required");
      error.statusCode = 400;
      throw error;
    }

    if (is_active !== false) {
      await PodQrCode.updateMany({ pod_id, is_active: true }, { $set: { is_active: false } });
    }

    return PodQrCode.create({
      pod_id,
      qr_token: qr_token || createToken(),
      expires_at,
      is_active: is_active !== undefined ? is_active : true,
    });
  }

  async getAllQrCodes(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.is_active !== undefined) query.is_active = filters.is_active === "true" || filters.is_active === true;

    return PodQrCode.find(query).sort({ createdAt: -1 });
  }

  async getQrCodeById(id) {
    const qr = await PodQrCode.findOne({ id });
    if (!qr) {
      const error = new Error("Pod QR code not found");
      error.statusCode = 404;
      throw error;
    }
    return qr;
  }

  async updateQrCode(id, data) {
    const qr = await this.getQrCodeById(id);

    if (data.expires_at !== undefined) qr.expires_at = data.expires_at;
    if (data.qr_token !== undefined) qr.qr_token = data.qr_token;

    if (data.is_active !== undefined) {
      if (data.is_active === true) {
        await PodQrCode.updateMany({ pod_id: qr.pod_id, is_active: true }, { $set: { is_active: false } });
      }
      qr.is_active = data.is_active;
    }

    await qr.save();
    return qr;
  }

  async deleteQrCode(id) {
    await this.getQrCodeById(id);
    await PodQrCode.deleteOne({ id });
    return { message: "Pod QR code deleted successfully" };
  }
}

module.exports = new PodQrCodeService();
