const PodItem = require("../models/PodItem");
const Pod = require("../models/Pod");
const Item = require("../models/Item");
const PodCluster = require("../models/PodCluster");

const createError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// Calculate status based on comparing expected vs current quantity
const calculateStatus = (expectedQuantity, currentQuantity) => {
  if (currentQuantity < expectedQuantity) {
    const missing = expectedQuantity - currentQuantity;
    return {
      status: "MISSING",
      message: `Missing ${missing} item(s)`,
      difference: -missing,
    };
  }
  if (currentQuantity > expectedQuantity) {
    const overstocked = currentQuantity - expectedQuantity;
    return {
      status: "OVERSTOCKED",
      message: `Overstocked by ${overstocked} item(s)`,
      difference: overstocked,
    };
  }
  return {
    status: "IN_STOCK",
    message: "Items match expected quantity",
    difference: 0,
  };
};

// Validate quantity inputs
const validateQuantity = (quantity, field = "quantity") => {
  const num = Number(quantity);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    throw createError(`${field} must be a non-negative integer`, 400);
  }
  return num;
};

class PodItemService {
  async createPodItem(data) {
    const { pod_id, item_id, expected_quantity = 0, current_quantity = 0 } = data;

    if (!pod_id || !item_id) {
      throw createError("pod_id and item_id are required", 400);
    }

    // Validate quantities
    const validatedExpected = validateQuantity(expected_quantity, "expected_quantity");
    const validatedCurrent = validateQuantity(current_quantity, "current_quantity");

    const [pod, item] = await Promise.all([
      Pod.findOne({ id: pod_id }).select("id name").lean(),
      Item.findOne({ id: item_id }).select("id name unit_price").lean(),
    ]);

    if (!pod) {
      throw createError("Pod not found", 404);
    }

    if (!item) {
      throw createError("Item not found", 404);
    }

    const existing = await PodItem.findOne({ pod_id, item_id });
    if (existing) {
      throw createError("Pod item already exists for this pod and item", 409);
    }

    const podItem = await PodItem.create({
      pod_id,
      item_id,
      expected_quantity: validatedExpected,
      current_quantity: validatedCurrent,
    });

    // Return enriched response with item details and status
    const statusInfo = calculateStatus(validatedExpected, validatedCurrent);
    return {
      ...podItem.toObject(),
      item: item,
      ...statusInfo,
    };
  }

  async createPodItemsForCluster(data) {
    const { cluster_id, items } = data || {};

    if (!cluster_id) {
      throw createError("cluster_id is required", 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw createError("items must be a non-empty array", 400);
    }

    const cluster = await PodCluster.findOne({ id: cluster_id }).select("id").lean();
    if (!cluster) {
      throw createError("Pod cluster not found", 404);
    }

    const pods = await Pod.find({ cluster_id }).select("id").lean();
    if (!pods.length) {
      throw createError("No pods found in this pod cluster", 404);
    }

    const normalizedItemsMap = new Map();
    items.forEach((entry, idx) => {
      if (!entry || !entry.item_id) {
        throw createError(`items[${idx}].item_id is required`, 400);
      }

      const itemId = String(entry.item_id);
      const expectedQuantity = validateQuantity(entry.expected_quantity ?? 0, `items[${idx}].expected_quantity`);
      const currentQuantity = validateQuantity(entry.current_quantity ?? 0, `items[${idx}].current_quantity`);

      normalizedItemsMap.set(itemId, {
        item_id: itemId,
        expected_quantity: expectedQuantity,
        current_quantity: currentQuantity,
      });
    });

    const normalizedItems = [...normalizedItemsMap.values()];
    const itemIds = normalizedItems.map((entry) => entry.item_id);
    const podIds = pods.map((pod) => pod.id);

    const existingItems = await Item.find({ id: { $in: itemIds } }).select("id").lean();
    const existingItemIdSet = new Set(existingItems.map((item) => item.id));
    const missingItemIds = itemIds.filter((itemId) => !existingItemIdSet.has(itemId));
    if (missingItemIds.length > 0) {
      throw createError(`Item not found: ${missingItemIds.join(", ")}`, 404);
    }

    const existingPodItems = await PodItem.find({
      pod_id: { $in: podIds },
      item_id: { $in: itemIds },
    })
      .select("pod_id item_id")
      .lean();

    const existingPairSet = new Set(existingPodItems.map((entry) => `${entry.pod_id}::${entry.item_id}`));

    const docsToInsert = [];
    for (const podId of podIds) {
      for (const itemEntry of normalizedItems) {
        const pairKey = `${podId}::${itemEntry.item_id}`;
        if (existingPairSet.has(pairKey)) {
          continue;
        }

        docsToInsert.push({
          pod_id: podId,
          item_id: itemEntry.item_id,
          expected_quantity: itemEntry.expected_quantity,
          current_quantity: itemEntry.current_quantity,
        });
      }
    }

    let created = [];
    if (docsToInsert.length > 0) {
      created = await PodItem.insertMany(docsToInsert, { ordered: false });
    }

    return {
      cluster_id,
      pod_count: podIds.length,
      input_item_count: items.length,
      unique_item_count: normalizedItems.length,
      total_target_pairs: podIds.length * normalizedItems.length,
      created_count: created.length,
      skipped_existing_count: existingPodItems.length,
      message:
        created.length > 0
          ? "Pod items assigned to cluster pods successfully"
          : "No new pod items were created (all selected items already existed on all pods)",
    };
  }

  async getAllPodItems(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.item_id) query.item_id = filters.item_id;

    const podItems = await PodItem.find(query).sort({ updated_at: -1 }).lean();

    // Enrich each pod item with item details and status
    const enrichedItems = await Promise.all(
      podItems.map(async (podItem) => {
        const item = await Item.findOne({ id: podItem.item_id })
          .select("id name unit_price")
          .lean();
        const statusInfo = calculateStatus(podItem.expected_quantity, podItem.current_quantity);

        return {
          ...podItem,
          item: item || null,
          ...statusInfo,
        };
      })
    );

    return enrichedItems;
  }

  async getPodItemById(id) {
    const podItem = await PodItem.findOne({ id }).lean();
    if (!podItem) {
      throw createError("Pod item not found", 404);
    }

    // Enrich with item details and status
    const item = await Item.findOne({ id: podItem.item_id })
      .select("id name unit_price")
      .lean();
    const statusInfo = calculateStatus(podItem.expected_quantity, podItem.current_quantity);

    return {
      ...podItem,
      item: item || null,
      ...statusInfo,
    };
  }

  async updatePodItem(id, data) {
    const podItem = await PodItem.findOne({ id });
    if (!podItem) {
      throw createError("Pod item not found", 404);
    }

    // Validate and update quantities
    if (data.expected_quantity !== undefined) {
      podItem.expected_quantity = validateQuantity(data.expected_quantity, "expected_quantity");
    }

    if (data.current_quantity !== undefined) {
      podItem.current_quantity = validateQuantity(data.current_quantity, "current_quantity");
    }

    await podItem.save();

    // Enrich response with item details and status
    const item = await Item.findOne({ id: podItem.item_id })
      .select("id name unit_price")
      .lean();
    const statusInfo = calculateStatus(podItem.expected_quantity, podItem.current_quantity);

    return {
      ...podItem.toObject(),
      item: item || null,
      ...statusInfo,
    };
  }

  async deletePodItem(id) {
    const podItem = await PodItem.findOne({ id });
    if (!podItem) {
      throw createError("Pod item not found", 404);
    }

    await PodItem.deleteOne({ id });
    return { message: "Pod item deleted successfully" };
  }

  // Helper: Update only current_quantity (for reconciliation/stock check)
  async updateCurrentQuantity(id, quantity) {
    const validatedQuantity = validateQuantity(quantity, "quantity");
    const podItem = await PodItem.findOne({ id });
    if (!podItem) {
      throw createError("Pod item not found", 404);
    }

    podItem.current_quantity = validatedQuantity;
    await podItem.save();

    const statusInfo = calculateStatus(podItem.expected_quantity, podItem.current_quantity);
    return {
      ...podItem.toObject(),
      ...statusInfo,
    };
  }

  // Helper: Get pods by location with item status summary
  async getPodItemsByLocation(location_id) {
    const pods = await Pod.find({ location_id }).select("id name").lean();
    if (!pods || pods.length === 0) {
      return [];
    }

    const result = await Promise.all(
      pods.map(async (pod) => {
        const podItems = await this.getAllPodItems({ pod_id: pod.id });
        const statusCounts = {
          in_stock: 0,
          missing: 0,
          overstocked: 0,
        };

        podItems.forEach((pi) => {
          const statusKey = pi.status.toLowerCase().replace("_", "");
          if (statusKey === "instock") statusCounts.in_stock++;
          if (statusKey === "missing") statusCounts.missing++;
          if (statusKey === "overstocked") statusCounts.overstocked++;
        });

        return {
          pod: pod,
          items: podItems,
          summary: statusCounts,
        };
      })
    );

    return result;
  }

  async getPodItemsByPodId(pod_id) {
    const pod = await Pod.findOne({ id: pod_id }).select("id name code").lean();
    if (!pod) {
      throw createError("Pod not found", 404);
    }

    const podItems = await PodItem.find({ pod_id }).sort({ updated_at: -1 }).lean();

    const enrichedItems = await Promise.all(
      podItems.map(async (podItem) => {
        const item = await Item.findOne({ id: podItem.item_id })
          .select("id name unit_price")
          .lean();
        const statusInfo = calculateStatus(podItem.expected_quantity, podItem.current_quantity);

        return {
          ...podItem,
          item_name: item ? item.name : null,
          item: item || null,
          ...statusInfo,
        };
      })
    );

    return {
      pod_id: pod.id,
      pod_name: pod.name,
      pod_code: pod.code,
      count: enrichedItems.length,
      items: enrichedItems,
    };
  }
}

module.exports = new PodItemService();
