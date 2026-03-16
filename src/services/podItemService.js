const PodItem = require("../models/PodItem");
const Pod = require("../models/Pod");
const Item = require("../models/Item");

class PodItemService {
  async createPodItem(data) {
    const { pod_id, item_id, expected_quantity = 0, current_quantity = 0 } = data;

    const [pod, item] = await Promise.all([
      Pod.findOne({ id: pod_id }),
      Item.findOne({ id: item_id }),
    ]);

    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    if (!item) {
      const error = new Error("Item not found");
      error.statusCode = 404;
      throw error;
    }

    const existing = await PodItem.findOne({ pod_id, item_id });
    if (existing) {
      const error = new Error("Pod item already exists for this pod and item");
      error.statusCode = 409;
      throw error;
    }

    return PodItem.create({ pod_id, item_id, expected_quantity, current_quantity });
  }

  async getAllPodItems(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.item_id) query.item_id = filters.item_id;

    return PodItem.find(query).sort({ updated_at: -1 });
  }

  async getPodItemById(id) {
    const podItem = await PodItem.findOne({ id });
    if (!podItem) {
      const error = new Error("Pod item not found");
      error.statusCode = 404;
      throw error;
    }
    return podItem;
  }

  async updatePodItem(id, data) {
    const podItem = await this.getPodItemById(id);

    if (data.expected_quantity !== undefined) podItem.expected_quantity = data.expected_quantity;
    if (data.current_quantity !== undefined) podItem.current_quantity = data.current_quantity;

    await podItem.save();
    return podItem;
  }

  async deletePodItem(id) {
    await this.getPodItemById(id);
    await PodItem.deleteOne({ id });
    return { message: "Pod item deleted successfully" };
  }
}

module.exports = new PodItemService();
