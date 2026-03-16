const PodDevice = require("../models/PodDevice");
const Pod = require("../models/Pod");

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
}

module.exports = new PodDeviceService();
