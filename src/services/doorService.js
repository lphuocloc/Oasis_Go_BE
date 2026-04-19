const Door = require("../models/Door");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const OnlineKey = require("../models/OnlineKey");
const Booking = require("../models/Bookings");
const { emitDoorUnlockRequest } = require("../socket/socketServer");

const readEnvMinutes = (key, fallback, min = 0) => {
  const raw = Number(process.env[key]);
  if (Number.isFinite(raw) && raw >= min) {
    return raw;
  }
  return fallback;
};

const CLEANER_POST_CHECKOUT_WINDOW_MINUTES = 30;
const CHECKIN_EARLY_WINDOW_MINUTES = readEnvMinutes("BOOKING_CHECKIN_EARLY_WINDOW_MINUTES", 15, 0);
const CHECKIN_EARLY_WINDOW_MS = CHECKIN_EARLY_WINDOW_MINUTES * 60 * 1000;

class DoorService {
  _resolveCleanerKeyWindow(booking, now = new Date()) {
    const validFrom = booking?.start_time
      ? new Date(new Date(booking.start_time).getTime() - CHECKIN_EARLY_WINDOW_MS)
      : now;
    const validTo = booking?.end_time
      ? new Date(
        Math.max(
          new Date(booking.end_time).getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000,
          now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000
        )
      )
      : new Date(now.getTime() + CLEANER_POST_CHECKOUT_WINDOW_MINUTES * 60 * 1000);

    return { validFrom, validTo };
  }

  async _reconcileCleanerKeyWindow(onlineKey, booking, now = new Date()) {
    if (!onlineKey || String(onlineKey.key_type || "").toUpperCase() !== "CLEANER") {
      return onlineKey;
    }

    const { validFrom, validTo } = this._resolveCleanerKeyWindow(booking, now);
    const currentValidFrom = new Date(onlineKey.valid_from || validFrom);
    const currentValidTo = new Date(onlineKey.valid_to || validTo);
    const nextValidFrom = new Date(Math.min(currentValidFrom.getTime(), validFrom.getTime()));
    const nextValidTo = new Date(Math.max(currentValidTo.getTime(), validTo.getTime()));

    if (
      nextValidFrom.getTime() !== currentValidFrom.getTime() ||
      nextValidTo.getTime() !== currentValidTo.getTime()
    ) {
      onlineKey.valid_from = nextValidFrom;
      onlineKey.valid_to = nextValidTo;
      await onlineKey.save();
    }

    return onlineKey;
  }

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

  async openDoorWithOnlineKey({ pod_id, key_token }) {
    if (!pod_id || !key_token) {
      const error = new Error("pod_id and key_token are required");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date();

    const onlineKey = await OnlineKey.findOne({
      pod_id,
      key_token,
      is_revoked: false,
    }).sort({ valid_from: -1 });

    if (!onlineKey) {
      const error = new Error("Online key đã hết hạn hoặc chưa hoạt động!");
      error.statusCode = 403;
      throw error;
    }

    const booking = await Booking.findOne({ id: onlineKey.booking_id }).select(
      "id pod_id checked_in_at status start_time end_time"
    );
    if (!booking) {
      const error = new Error("Booking không tìm thấy cho online key này!");
      error.statusCode = 404;
      throw error;
    }

    await this._reconcileCleanerKeyWindow(onlineKey, booking, now);

    if (onlineKey.valid_from > now || onlineKey.valid_to < now) {
      const error = new Error("Online key đã hết hạn hoặc chưa hoạt động!");
      error.statusCode = 403;
      throw error;
    }

    if (!booking.checked_in_at) {
      const error = new Error("Booking chưa được check-in, không thể mở cửa!");
      error.statusCode = 409;
      throw error;
    }

    const door = await this.ensureDoorForPod(pod_id);
    door.lock_status = "UNLOCKED";
    door.last_sync_at = new Date();
    await door.save();

    const delivered = emitDoorUnlockRequest({
      pod_id,
      payload: {
        booking_id: booking.id,
        key_type: onlineKey.key_type,
        type: "success",
        message: "Cửa đã mở, mời bạn vào bên trong và đóng cửa lại sau khi vào nhé!",
      },
    });
    return {
      pod_id,
      booking_id: booking.id,
      lock_status: door.lock_status,
      socket_delivered: delivered,
      unlocked_at: door.last_sync_at,
    };
  }

  async generateDoorsByPodCluster(clusterId) {
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
    const existingDoors = await Door.find({ pod_id: { $in: podIds } }).select("pod_id");
    const existingPodIdSet = new Set(existingDoors.map((door) => door.pod_id));

    const docsToCreate = pods
      .filter((pod) => !existingPodIdSet.has(pod.id))
      .map((pod) => ({
        pod_id: pod.id,
        lock_status: "LOCKED",
        door_sensor: "CLOSED",
      }));

    const createdDoors = docsToCreate.length > 0
      ? await Door.insertMany(docsToCreate, { ordered: false })
      : [];

    return {
      cluster_id: cluster.id,
      cluster_name: cluster.name,
      total_pods: pods.length,
      existing_doors: existingDoors.length,
      created_count: createdDoors.length,
      skipped_count: pods.length - createdDoors.length,
      created_doors: createdDoors,
    };
  }
}

module.exports = new DoorService();
