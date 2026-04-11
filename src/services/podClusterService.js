const PodCluster = require("../models/PodCluster");
const PodClusterImage = require("../models/PodClusterImage");
const Location = require("../models/Location");
const Pod = require("../models/Pod");
const PricingRule = require("../models/PricingRule");
const Review = require("../models/Review");
const { LEAF_TYPES } = require("./locationService");

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
            const error = new Error("Invalid 'at' datetime. Expected UTC ISO-8601 format.");
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
            PricingRule.find({ location_id: locationId, is_active: true }).sort({ createdAt: -1 }),
            Pod.find({ cluster_id: clusterId }).select("id").lean(),
        ]);

        const podIds = pods.map((pod) => String(pod.id)).filter(Boolean);
        const podRules = podIds.length > 0
            ? await PricingRule.find({ pod_id: { $in: podIds }, is_active: true }).sort({ createdAt: -1 })
            : [];

        const matchedLocationRules = locationRules.filter((rule) => rule.matchesUtcDate(queriedAt));
        const matchedPodRules = podRules.filter((rule) => rule.matchesUtcDate(queriedAt));

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
        const clusterIds = podClusters.map(cluster => cluster.id);
        const images = await PodClusterImage.find({ cluster_id: { $in: clusterIds } })
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

        const podClustersWithImages = podClusters.map(cluster => {
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
        const podCluster = await PodCluster.findOne({ id: clusterId })
            .populate("location");

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
    async createPodCluster({ location_id, name, description, base_price_modifier, slot_duration_minutes, image_urls }) {
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
            throw new Error(`Pod clusters can only be created in ${LEAF_TYPES.join(", ")} type locations`);
        }

        const parsedSlotDuration = slot_duration_minutes !== undefined
            ? Number(slot_duration_minutes)
            : 30;

        if (!ALLOWED_SLOT_DURATIONS.includes(parsedSlotDuration)) {
            const error = new Error(`slot_duration_minutes must be one of: ${ALLOWED_SLOT_DURATIONS.join(", ")}`);
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

            const imagePromises = uniqueUrls.map(url =>
                PodClusterImage.create({
                    cluster_id: podCluster.id,
                    image_url: url,
                })
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
        const { location_id, name, description, base_price_modifier, slot_duration_minutes, image_urls } = updates;

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
                throw new Error(`Pod clusters can only be in ${LEAF_TYPES.join(", ")} type locations`);
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
                const error = new Error(`slot_duration_minutes must be one of: ${ALLOWED_SLOT_DURATIONS.join(", ")}`);
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
                cluster_id: podCluster.id
            }).select('image_url');
            const existingUrls = new Set(existingImages.map(img => img.image_url));

            // Chỉ thêm những URLs chưa tồn tại
            const newUrls = uniqueUrls.filter(url => !existingUrls.has(url));

            if (newUrls.length > 0) {
                const imagePromises = newUrls.map(url =>
                    PodClusterImage.create({
                        cluster_id: podCluster.id,
                        image_url: url,
                    })
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
            const error = new Error("Cannot delete pod cluster with pods. Delete pods first.");
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

        const images = await PodClusterImage.find({ cluster_id: clusterId })
            .sort({ createdAt: -1 });

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
            cluster_id: clusterId
        });

        if (!image) {
            const error = new Error("Image not found or does not belong to this pod cluster");
            error.statusCode = 404;
            throw error;
        }

        await PodClusterImage.deleteOne({ id: imageId });

        return { message: "Image deleted successfully" };
    }
}

module.exports = new PodClusterService();
