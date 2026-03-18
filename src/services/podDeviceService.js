const PodDevice = require("../models/PodDevice");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");

class PodDeviceService {
  async createDevice(data) {
    const { pod_id, device_name, device_id, auth_token, is_online, last_ping } = data;

    const pod = await Pod.findOne({ id: pod_id });
    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    return PodDevice.create({
      pod_id,
      device_name,
      device_id,
      auth_token: auth_token ?? null,
      is_online: is_online ?? false,
      last_ping: last_ping ?? null,
    });
  }

  async getAllDevices(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.is_online !== undefined) query.is_online = filters.is_online === "true" || filters.is_online === true;

    return PodDevice.find(query).sort({ createdAt: -1 });
  }

  async getDevicesByPodCluster(clusterId, filters = {}) {
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
    const podIds = pods.map((pod) => pod.id);
    const podsById = new Map(pods.map((pod) => [pod.id, pod]));

    if (podIds.length === 0) {
      return {
        cluster_id: cluster.id,
        cluster_name: cluster.name,
        total_pods: 0,
        total_devices: 0,
        devices: [],
      };
    }

    const query = { pod_id: { $in: podIds } };
    if (filters.is_online !== undefined) {
      query.is_online = filters.is_online === "true" || filters.is_online === true;
    }

    const devices = await PodDevice.find(query).sort({ createdAt: -1 });
    const mappedDevices = devices.map((device) => ({
      ...device.toObject(),
      pod: podsById.get(device.pod_id)
        ? {
          id: podsById.get(device.pod_id).id,
          code: podsById.get(device.pod_id).code,
          name: podsById.get(device.pod_id).name,
        }
        : null,
    }));

    return {
      cluster_id: cluster.id,
      cluster_name: cluster.name,
      total_pods: pods.length,
      total_devices: mappedDevices.length,
      devices: mappedDevices,
    };
  }

  async getDeviceById(id) {
    const device = await PodDevice.findOne({ id });
    if (!device) {
      const error = new Error("Pod device not found");
      error.statusCode = 404;
      throw error;
    }
    return device;
  }

  async updateDevice(id, data) {
    const device = await this.getDeviceById(id);

    if (data.device_name !== undefined) device.device_name = data.device_name;
    if (data.device_id !== undefined) device.device_id = data.device_id;
    if (data.auth_token !== undefined) device.auth_token = data.auth_token;
    if (data.is_online !== undefined) device.is_online = data.is_online;
    if (data.last_ping !== undefined) device.last_ping = data.last_ping;

    await device.save();
    return device;
  }

  async deleteDevice(id) {
    await this.getDeviceById(id);
    await PodDevice.deleteOne({ id });
    return { message: "Pod device deleted successfully" };
  }

  async generateDevicesByPodCluster(clusterId, options = {}) {
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

    const podIds = pods.map((pod) => pod.id);
    const existingDevices = await PodDevice.find({ pod_id: { $in: podIds } });
    const existingByPodId = new Map(existingDevices.map((device) => [device.pod_id, device]));

    const deviceNamePrefix = options.device_name_prefix || "Pod Device";
    const deviceIdPrefix = options.device_id_prefix || "PODDEV";

    const docsToCreate = [];
    const skipped = [];

    for (const pod of pods) {
      if (existingByPodId.has(pod.id)) {
        skipped.push({ pod_id: pod.id, pod_code: pod.code, reason: "Device already exists" });
        continue;
      }

      docsToCreate.push({
        pod_id: pod.id,
        device_name: `${deviceNamePrefix} ${pod.code}`,
        device_id: `${deviceIdPrefix}-${pod.code}-${pod.id.slice(0, 8)}`.toUpperCase(),
        auth_token: null,
        is_online: false,
        last_ping: null,
      });
    }

    const createdDevices = docsToCreate.length > 0 ? await PodDevice.insertMany(docsToCreate, { ordered: true }) : [];

    return {
      cluster_id: cluster.id,
      cluster_name: cluster.name,
      total_pods: pods.length,
      existing_devices: existingDevices.length,
      created_count: createdDevices.length,
      skipped_count: skipped.length,
      created_devices: createdDevices,
      skipped,
    };
  }
}

module.exports = new PodDeviceService();
