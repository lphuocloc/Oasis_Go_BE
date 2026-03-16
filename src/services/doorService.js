const Door = require("../models/Door");
const Pod = require("../models/Pod");

class DoorService {
  async createDoor(data) {
    const { pod_id, lock_status = "LOCKED", door_sensor = "CLOSED" } = data;

    const pod = await Pod.findOne({ id: pod_id });
    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    const existing = await Door.findOne({ pod_id });
    if (existing) {
      const error = new Error("Door already exists for this pod");
      error.statusCode = 409;
      throw error;
    }

    return Door.create({ pod_id, lock_status, door_sensor });
  }

  async ensureDoorForPod(pod_id) {
    let door = await Door.findOne({ pod_id });
    if (!door) {
      door = await Door.create({ pod_id, lock_status: "LOCKED", door_sensor: "CLOSED" });
    }
    return door;
  }

  async getAllDoors(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.lock_status) query.lock_status = filters.lock_status;
    if (filters.door_sensor) query.door_sensor = filters.door_sensor;

    return Door.find(query).sort({ createdAt: -1 });
  }

  async getDoorById(id) {
    const door = await Door.findOne({ id });
    if (!door) {
      const error = new Error("Door not found");
      error.statusCode = 404;
      throw error;
    }
    return door;
  }

  async updateDoor(id, data) {
    const door = await this.getDoorById(id);

    if (data.lock_status !== undefined) door.lock_status = data.lock_status;
    if (data.door_sensor !== undefined) door.door_sensor = data.door_sensor;
    if (data.last_sync_at !== undefined) door.last_sync_at = data.last_sync_at;

    await door.save();
    return door;
  }

  async deleteDoor(id) {
    await this.getDoorById(id);
    await Door.deleteOne({ id });
    return { message: "Door deleted successfully" };
  }
}

module.exports = new DoorService();
