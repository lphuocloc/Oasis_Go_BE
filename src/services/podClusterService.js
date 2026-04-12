const PodCluster = require("../models/PodCluster");
const PodClusterImage = require("../models/PodClusterImage");
const Location = require("../models/Location");
const Pod = require("../models/Pod");
const PricingRule = require("../models/PricingRule");
const Review = require("../models/Review");
const { LEAF_TYPES } = require("./locationService");
const voucherService = require("./voucherService");

const ALLOWED_SLOT_DURATIONS = [30, 60, 90, 120];
const DEFAULT_RATING_STATS = {
  avgRating: 0,
  totalReviews: 0,
  ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

class PodClusterService {
  _toUtcDate(value) {
    if (!value) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      const error = new Error(
        "Invalid 'at' datetime. Expected UTC ISO-8601 format.",
      );
      error.statusCode = 400;
      throw error;
    }
    return date;
  }

  _formatEffectiveRule(rule = null) {
    if (!rule) return null;

    const multiplier = Number(rule.multiplier ?? rule.price_modifier ?? 1);

    return {
      id: rule.id,
      scope: rule.pod_id ? "POD" : "LOCATION",
      multiplier,
      applied_modifier: multiplier,
      start_time: rule.start_time,
      end_time: rule.end_time,
      days_of_week: rule.days_of_week,
    };
  }

  async _buildPricingSummary({ clusterId, locationId, at }) {
    const queriedAt = this._toUtcDate(at);

    const [locationRules, pods] = await Promise.all([
      PricingRule.find({ location_id: locationId, is_active: true }).sort({
        createdAt: -1,
      }),
      Pod.find({ cluster_id: clusterId }).select("id").lean(),
    ]);

    const podIds = pods.map((pod) => String(pod.id)).filter(Boolean);
    const podRules =
      podIds.length > 0
        ? await PricingRule.find({
            pod_id: { $in: podIds },
            is_active: true,
          }).sort({ createdAt: -1 })
        : [];

    const matchedLocationRules = locationRules.filter((rule) =>
      rule.matchesUtcDate(queriedAt),
    );
    const matchedPodRules = podRules.filter((rule) =>
      rule.matchesUtcDate(queriedAt),
    );

    const effectiveRule = matchedPodRules[0] || matchedLocationRules[0] || null;

    return {
      queried_at_utc: queriedAt.toISOString(),
      has_location_rule: matchedLocationRules.length > 0,
      has_pod_rule: matchedPodRules.length > 0,
      effective_rule: this._formatEffectiveRule(effectiveRule),
    };
  }

  /**
   * Lấy tất cả pod clusters với filters
   */
  async getAllPodClusters({ location_id, scope_location_ids }) {
    const filter = {};

    const scopedLocationIds = scope_location_ids
      ? String(scope_location_ids)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    if (scopedLocationIds.length > 0) {
      if (location_id) {
        if (!scopedLocationIds.includes(String(location_id))) {
          return [];
        }
        filter.location_id = location_id;
      } else {
        filter.location_id = { $in: scopedLocationIds };
      }
    } else if (location_id) {
      filter.location_id = location_id;
    }

    const podClusters = await PodCluster.find(filter)
      .populate("location")
      .sort({ createdAt: -1 });

    if (podClusters.length === 0) {
      return podClusters;
    }

    // Fetch all images in one query, then group by cluster_id
    const clusterIds = podClusters.map((cluster) => cluster.id);
    const images = await PodClusterImage.find({
      cluster_id: { $in: clusterIds },
    })
      .select("id cluster_id image_url createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const ratingStats = await Review.aggregate([
      {
        $match: {
          cluster_id: { $in: clusterIds },
          is_rejected: false,
          rating: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$cluster_id",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          cluster_id: "$_id",
          avgRating: { $round: ["$avgRating", 2] },
          totalReviews: 1,
          ratingCounts: {
            1: "$rating1",
            2: "$rating2",
            3: "$rating3",
            4: "$rating4",
            5: "$rating5",
          },
        },
      },
    ]);

    const ratingMap = ratingStats.reduce((map, stat) => {
      map[stat.cluster_id] = {
        avgRating: stat.avgRating,
        totalReviews: stat.totalReviews,
        ratingCounts: stat.ratingCounts,
      };
      return map;
    }, {});

    const imageMap = images.reduce((map, image) => {
      if (!map[image.cluster_id]) {
        map[image.cluster_id] = [];
      }
      map[image.cluster_id].push(image);
      return map;
    }, {});

    const podClustersWithImages = podClusters.map((cluster) => {
      const clusterObj = cluster.toObject();
      clusterObj.images = imageMap[cluster.id] || [];
      clusterObj.rating = ratingMap[cluster.id] || DEFAULT_RATING_STATS;
      return clusterObj;
    });

    return podClustersWithImages;
  }

  /**
   * Lấy pod cluster theo ID
   */
  async getPodClusterById(clusterId, options = {}) {
    const podCluster = await PodCluster.findOne({ id: clusterId }).populate(
      "location",
    );

    if (!podCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    // Lấy images của pod cluster
    const images = await PodClusterImage.find({ cluster_id: clusterId })
      .select("id image_url createdAt")
      .sort({ createdAt: -1 });

    // Thêm images vào object trả về
    const podClusterObj = podCluster.toObject();
    podClusterObj.images = images;
    podClusterObj.rating = await Review.getClusterStats(clusterId);
    podClusterObj.pricing_summary = await this._buildPricingSummary({
      clusterId,
      locationId: podCluster.location_id,
      at: options.at,
    });

    return podClusterObj;
  }

  /**
   * Lấy pod clusters theo location
   */
  async getPodClustersByLocation(locationId) {
    const podClusters = await PodCluster.getByLocation(locationId);
    return podClusters;
  }

  /**
   * Tạo pod cluster mới
   */
  async createPodCluster({
    location_id,
    name,
    description,
    base_price_modifier,
    slot_duration_minutes,
    image_urls,
  }) {
    // Validate required fields
    if (!location_id || !name) {
      throw new Error("Location ID and name are required");
    }

    // Validate location exists
    const location = await Location.findOne({ id: location_id });
    if (!location) {
      const error = new Error("Location not found");
      error.statusCode = 404;
      throw error;
    }

    // Validate location type (chỉ leaf locations mới có pod clusters)
    if (!LEAF_TYPES.includes(location.type)) {
      throw new Error(
        `Pod clusters can only be created in ${LEAF_TYPES.join(", ")} type locations`,
      );
    }

    const parsedSlotDuration =
      slot_duration_minutes !== undefined ? Number(slot_duration_minutes) : 30;

    if (!ALLOWED_SLOT_DURATIONS.includes(parsedSlotDuration)) {
      const error = new Error(
        `slot_duration_minutes must be one of: ${ALLOWED_SLOT_DURATIONS.join(", ")}`,
      );
      error.statusCode = 400;
      throw error;
    }

    // Create pod cluster
    const podCluster = await PodCluster.create({
      location_id,
      name,
      description,
      base_price_modifier: base_price_modifier || 1.0,
      slot_duration_minutes: parsedSlotDuration,
    });

    // Lưu images nếu có
    if (image_urls && image_urls.length > 0) {
      // Lọc duplicate URLs trong request
      const uniqueUrls = [...new Set(image_urls)];

      const imagePromises = uniqueUrls.map((url) =>
        PodClusterImage.create({
          cluster_id: podCluster.id,
          image_url: url,
        }),
      );
      await Promise.all(imagePromises);
    }

    // Populate location
    await podCluster.populate("location");

    return podCluster;
  }

  /**
   * Cập nhật pod cluster
   */
  async updatePodCluster(clusterId, updates) {
    const {
      location_id,
      name,
      description,
      base_price_modifier,
      slot_duration_minutes,
      image_urls,
    } = updates;

    const podCluster = await PodCluster.findOne({ id: clusterId });
    if (!podCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    // Validate location if changing
    if (location_id && location_id !== podCluster.location_id) {
      const location = await Location.findOne({ id: location_id });
      if (!location) {
        const error = new Error("Location not found");
        error.statusCode = 404;
        throw error;
      }

      if (!LEAF_TYPES.includes(location.type)) {
        throw new Error(
          `Pod clusters can only be in ${LEAF_TYPES.join(", ")} type locations`,
        );
      }

      podCluster.location_id = location_id;
    }

    // Update fields
    if (name) podCluster.name = name;
    if (description !== undefined) podCluster.description = description;
    if (base_price_modifier !== undefined) {
      podCluster.base_price_modifier = base_price_modifier;
    }

    if (slot_duration_minutes !== undefined) {
      const parsedSlotDuration = Number(slot_duration_minutes);

      if (!ALLOWED_SLOT_DURATIONS.includes(parsedSlotDuration)) {
        const error = new Error(
          `slot_duration_minutes must be one of: ${ALLOWED_SLOT_DURATIONS.join(", ")}`,
        );
        error.statusCode = 400;
        throw error;
      }

      podCluster.slot_duration_minutes = parsedSlotDuration;
    }

    await podCluster.save();

    // Thêm images mới nếu có
    if (image_urls && image_urls.length > 0) {
      // Lọc duplicate URLs trong request
      const uniqueUrls = [...new Set(image_urls)];

      // Lấy danh sách URLs đã tồn tại trong DB
      const existingImages = await PodClusterImage.find({
        cluster_id: podCluster.id,
      }).select("image_url");
      const existingUrls = new Set(existingImages.map((img) => img.image_url));

      // Chỉ thêm những URLs chưa tồn tại
      const newUrls = uniqueUrls.filter((url) => !existingUrls.has(url));

      if (newUrls.length > 0) {
        const imagePromises = newUrls.map((url) =>
          PodClusterImage.create({
            cluster_id: podCluster.id,
            image_url: url,
          }),
        );
        await Promise.all(imagePromises);
      }
    }

    await podCluster.populate("location");

    return podCluster;
  }

  /**
   * Xóa pod cluster
   */
  async deletePodCluster(clusterId) {
    const podCluster = await PodCluster.findOne({ id: clusterId });
    if (!podCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    // Kiểm tra có pods không
    const Pod = require("../models/Pod");
    const pods = await Pod.find({ cluster_id: clusterId });
    if (pods.length > 0) {
      const error = new Error(
        "Cannot delete pod cluster with pods. Delete pods first.",
      );
      error.statusCode = 400;
      throw error;
    }

    // Xóa tất cả images của pod cluster
    await PodClusterImage.deleteMany({ cluster_id: clusterId });

    await PodCluster.deleteOne({ id: clusterId });

    return { message: "Pod cluster deleted successfully" };
  }

  /**
   * Lấy tất cả images của pod cluster
   */
  async getPodClusterImages(clusterId) {
    // Kiểm tra pod cluster tồn tại
    const podCluster = await PodCluster.findOne({ id: clusterId });
    if (!podCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    const images = await PodClusterImage.find({ cluster_id: clusterId }).sort({
      createdAt: -1,
    });

    return images;
  }

  /**
   * Xóa một image của pod cluster
   */
  async deletePodClusterImage(clusterId, imageId) {
    // Kiểm tra pod cluster tồn tại
    const podCluster = await PodCluster.findOne({ id: clusterId });
    if (!podCluster) {
      const error = new Error("Pod cluster not found");
      error.statusCode = 404;
      throw error;
    }

    // Kiểm tra image tồn tại và thuộc về pod cluster này
    const image = await PodClusterImage.findOne({
      id: imageId,
      cluster_id: clusterId,
    });

    if (!image) {
      const error = new Error(
        "Image not found or does not belong to this pod cluster",
      );
      error.statusCode = 404;
      throw error;
    }

    await PodClusterImage.deleteOne({ id: imageId });

    return { message: "Image deleted successfully" };
  }

  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Bán kính Trái Đất (km)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --- HÀM TÍNH KHOẢNG CÁCH (HAVERSINE FORMULA) ---
  // --- HÀM TÍNH KHOẢNG CÁCH (HAVERSINE FORMULA) ---
  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --- HÀM GỢI Ý CỤM POD (RECOMMENDATIONS) ---
  async getRecommendations(userLocation, priority = "balanced") {
    const UNIT_PRICE = 10000;
    const now = new Date(); // Lấy thời gian hiện tại để so sánh voucher

    const [allLocations, voucherData] = await Promise.all([
      Location.find({ isActive: true }).lean(),
      voucherService.getVouchers({ is_active: true }),
    ]);

    const locationMap = new Map(
      allLocations.map((loc) => [loc.id.toString(), loc]),
    );

    // --- 1. LỌC VOUCHER "SẠCH" (CÒN HẠN, CÒN LƯỢT) ---
    const validVouchers = (voucherData.items || []).filter((v) => {
      const isStarted = v.valid_from ? new Date(v.valid_from) <= now : true;
      const isNotExpired = v.valid_to ? new Date(v.valid_to) >= now : true;
      const hasUsageLeft = v.usage_limit ? v.usage_count < v.usage_limit : true;
      return isStarted && isNotExpired && hasUsageLeft && v.is_active;
    });

    const clusters = await this.getAllPodClusters({});

    const WEIGHTS = {
      balanced: { dist: 40, promo: 30, price: 30 },
      distance: { dist: 90, promo: 5, price: 5 },
      promotion: { dist: 20, promo: 80, price: 0 },
      price: { dist: 10, promo: 10, price: 100 },
    };
    const currentWeight = WEIGHTS[priority] || WEIGHTS.balanced;

    let processed = clusters.map((cluster) => {
      let score = 0;

      // --- 2. TÍNH GIÁ HIỆN TẠI (THEO KHUNG GIỜ) ---
      const multiplier =
        cluster.pricing_summary?.effective_rule?.multiplier || 1;
      const originalPrice =
        (cluster.base_price_modifier || 0) * UNIT_PRICE * multiplier;

      // --- 3. LOGIC TÌM TỌA ĐỘ ---
      let finalLat = null,
        finalLng = null;
      let currentLoc = locationMap.get(cluster.location_id?.toString());
      while (currentLoc) {
        if (currentLoc.lat != null && currentLoc.lng != null) {
          finalLat = currentLoc.lat;
          finalLng = currentLoc.lng;
          break;
        }
        currentLoc = currentLoc.parent_id
          ? locationMap.get(currentLoc.parent_id.toString())
          : null;
      }

      // --- 4. TÍNH KHOẢNG CÁCH ---
      let distance = null;
      if (
        userLocation?.latitude &&
        userLocation?.longitude &&
        finalLat &&
        finalLng
      ) {
        distance = this._calculateDistance(
          Number(userLocation.latitude),
          Number(userLocation.longitude),
          Number(finalLat),
          Number(finalLng),
        );
      }

      // --- 5. TÍNH VOUCHER TỐT NHẤT TRÊN TỔNG ĐƠN ---
      // (Vì voucher tính theo tổng đơn, ta so sánh originalPrice với min_booking_value)
      let bestDiscount = 0;
      let bestVoucher = null;
      validVouchers.forEach((v) => {
        if (originalPrice >= v.min_booking_value) {
          let d =
            v.discount_type === "PERCENT"
              ? Math.min(
                  (originalPrice * v.discount_value) / 100,
                  v.max_discount || Infinity,
                )
              : v.discount_value;
          if (d > bestDiscount) {
            bestDiscount = d;
            bestVoucher = v;
          }
        }
      });

      const finalPrice = Math.max(0, originalPrice - bestDiscount);
      const discountPct = originalPrice > 0 ? bestDiscount / originalPrice : 0;

      // --- 6. TÍNH TOÁN SCORE ---
      if (distance !== null) {
        score += Math.max(0, currentWeight.dist - distance * 4);
        if (distance < 1.5) score += 30; // Thưởng khoảng cách đi bộ
      }

      score += discountPct * currentWeight.promo;

      if (currentWeight.price > 0) {
        // Nghịch đảo giá: Pod càng rẻ so với mốc 200k thì điểm càng cao
        const priceInverseFactor = Math.max(0, (200000 - finalPrice) / 2000);
        score += priceInverseFactor * (currentWeight.price / 100);
      }

      if (distance !== null) score += 0.001 / (distance + 0.1);

      return {
        ...cluster,
        original_price: originalPrice,
        final_price: finalPrice,
        distance: distance !== null ? parseFloat(distance.toFixed(2)) : null,
        discount_pct: discountPct,
        best_voucher: bestVoucher
          ? { code: bestVoucher.code, discount_amount: bestDiscount }
          : null,
        recommendation_score: parseFloat(score.toFixed(3)),
        suggestion_tags: [],
      };
    });

    // --- 7. SẮP XẾP VÀ GẮN TAG ---
    if (processed.length > 0) {
      if (priority === "price") {
        processed.sort((a, b) => a.final_price - b.final_price);
      } else {
        processed.sort(
          (a, b) => b.recommendation_score - a.recommendation_score,
        );
      }

      processed = processed.slice(0, 4);

      const minPrice = Math.min(...processed.map((c) => c.final_price));
      const validDistances = processed
        .filter((c) => c.distance !== null)
        .map((c) => c.distance);
      const minDistance =
        validDistances.length > 0 ? Math.min(...validDistances) : null;

      processed = processed.map((c, index) => {
        const tags = [];
        if (index === 0)
          tags.push(priority === "price" ? "GIÁ TỐT" : "PHÙ HỢP");
        if (minDistance !== null && c.distance === minDistance)
          tags.push("GẦN BẠN");
        if (c.final_price === minPrice && priority !== "price")
          tags.push("GIÁ RẺ");
        if (c.discount_pct >= 0.2) tags.push("ƯU ĐÃI KHỦNG");

        return { ...c, suggestion_tags: tags };
      });
    }

    return processed;
  }
}

module.exports = new PodClusterService();
