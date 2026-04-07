const PodCluster = require("../models/PodCluster");
const PodClusterImage = require("../models/PodClusterImage");
const Location = require("../models/Location");
const { LEAF_TYPES } = require("./locationService");
const voucherService = require("./voucherService");

const ALLOWED_SLOT_DURATIONS = [30, 60, 90, 120];

class PodClusterService {
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
      return clusterObj;
    });

    return podClustersWithImages;
  }

  /**
   * Lấy pod cluster theo ID
   */
  async getPodClusterById(clusterId) {
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

    const [allLocations, voucherData] = await Promise.all([
      Location.find({ isActive: true }).lean(),
      voucherService.getVouchers({ is_active: true }),
    ]);

    const locationMap = new Map(
      allLocations.map((loc) => [loc.id.toString(), loc]),
    );
    const allVouchers = voucherData.items || [];
    const clusters = await this.getAllPodClusters({});

    // Trọng số
    const WEIGHTS = {
      balanced: { dist: 40, promo: 40, img: 20 },
      distance: { dist: 80, promo: 10, img: 10 },
      promotion: { dist: 20, promo: 70, img: 10 },
      price: { dist: 20, promo: 20, img: 10 },
    };
    const currentWeight = WEIGHTS[priority] || WEIGHTS.balanced;

    // 2. Xử lý từng Cluster
    let processed = clusters.map((cluster) => {
      let score = 0;
      const originalPrice = (cluster.base_price_modifier || 0) * UNIT_PRICE;

      // --- LOGIC LEO CÂY TÌM TỌA ĐỘ ---
      let finalLat = null;
      let finalLng = null;
      let currentLoc = locationMap.get(cluster.location_id?.toString());

      while (currentLoc) {
        if (
          currentLoc.lat !== null &&
          currentLoc.lng !== null &&
          currentLoc.lat !== undefined
        ) {
          finalLat = currentLoc.lat;
          finalLng = currentLoc.lng;
          break;
        }
        const parentId = currentLoc.parent_id?.toString();
        currentLoc = parentId ? locationMap.get(parentId) : null;
      }

      // --- TÍNH KHOẢNG CÁCH ---
      let distance = null;
      const uLat = userLocation?.latitude;
      const uLng = userLocation?.longitude;

      if (uLat && uLng && finalLat && finalLng) {
        distance = this._calculateDistance(
          Number(uLat),
          Number(uLng),
          Number(finalLat),
          Number(finalLng),
        );
      }

      // --- TÍNH VOUCHER ---
      let bestDiscount = 0;
      let bestVoucher = null;
      allVouchers.forEach((v) => {
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

      // --- TÍNH SCORE ---
      if (distance !== null) {
        score += Math.max(0, currentWeight.dist - distance * 4);
        if (distance < 2) score += 50;
      }
      score += discountPct * currentWeight.promo;
      if (cluster.images?.length > 0) score += currentWeight.img;
      else score -= 30;

      // Tie-breaker
      if (distance !== null) score += 0.001 / (distance + 0.1);

      return {
        ...cluster,
        original_price: originalPrice,
        final_price: finalPrice,
        distance: distance !== null ? parseFloat(distance.toFixed(2)) : null,
        discount_pct: discountPct,
        best_voucher: bestVoucher
          ? {
              code: bestVoucher.code,
              discount_amount: bestDiscount,
              description: bestVoucher.description,
            }
          : null,
        recommendation_score: parseFloat(score.toFixed(3)),
        suggestion_tags: [],
      };
    });

    // 3. Sắp xếp, Gắn nhãn và Giới hạn kết quả
    if (processed.length > 0) {
      // Sắp xếp theo điểm cao nhất lên đầu
      processed.sort((a, b) => b.recommendation_score - a.recommendation_score);

      // Chỉ lấy 4 cụm Pod tốt nhất (hoặc 3 tùy bạn chỉnh số 4)
      processed = processed.slice(0, 4);

      // Lấy giá trị tốt nhất trong Top 4 để so sánh gắn Tag
      const topScore = processed[0].recommendation_score;

      // Tìm khoảng cách nhỏ nhất trong số những cái có distance (tránh lỗi null)
      const validDistances = processed
        .filter((c) => c.distance !== null)
        .map((c) => c.distance);
      const minDistance =
        validDistances.length > 0 ? Math.min(...validDistances) : null;

      processed = processed.map((c) => {
        const tags = [];

        // Tag PHÙ HỢP NHẤT: Dành cho thằng đứng đầu bảng điểm
        if (c.recommendation_score === topScore && topScore > 0) {
          tags.push("PHÙ HỢP NHẤT");
        }

        // Tag GẦN BẠN NHẤT: Phải khớp với khoảng cách nhỏ nhất tìm được
        if (minDistance !== null && c.distance === minDistance) {
          tags.push("GẦN BẠN NHẤT");
        }

        // Tag ƯU ĐÃI KHỦNG: Nếu giảm trên 20% (Logic thêm để phong phú)
        if (c.discount_pct >= 0.2) {
          tags.push("ƯU ĐÃI KHỦNG");
        }

        return { ...c, suggestion_tags: tags };
      });
    }

    return processed;
  }
}

module.exports = new PodClusterService();
