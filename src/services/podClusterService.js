const PodCluster = require("../models/PodCluster");
const PodClusterImage = require("../models/PodClusterImage");
const Location = require("../models/Location");
const { LEAF_TYPES } = require("./locationService");

class PodClusterService {
    /**
     * Lấy tất cả pod clusters với filters
     */
    async getAllPodClusters({ location_id }) {
        const filter = {};

        if (location_id) filter.location_id = location_id;

        const podClusters = await PodCluster.find(filter)
            .populate("location")
            .sort({ createdAt: -1 });

        return podClusters;
    }

    /**
     * Lấy pod cluster theo ID
     */
    async getPodClusterById(clusterId) {
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
    async createPodCluster({ location_id, name, description, base_price_modifier, image_urls }) {
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

        // Create pod cluster
        const podCluster = await PodCluster.create({
            location_id,
            name,
            description,
            base_price_modifier: base_price_modifier || 1.0,
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
        const { location_id, name, description, base_price_modifier, image_urls } = updates;

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
