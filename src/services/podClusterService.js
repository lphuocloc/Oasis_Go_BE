const PodCluster = require("../models/PodCluster");
const Location = require("../models/Location");

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

        return podCluster;
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
    async createPodCluster({ location_id, name, description, base_price_modifier }) {
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

        // Validate location type (chỉ BUILDING mới có pod clusters)
        if (location.type !== "BUILDING") {
            throw new Error("Pod clusters can only be created in BUILDING type locations");
        }

        // Create pod cluster
        const podCluster = await PodCluster.create({
            location_id,
            name,
            description,
            base_price_modifier: base_price_modifier || 1.0,
        });

        // Populate location
        await podCluster.populate("location");

        return podCluster;
    }

    /**
     * Cập nhật pod cluster
     */
    async updatePodCluster(clusterId, updates) {
        const { location_id, name, description, base_price_modifier } = updates;

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

            if (location.type !== "BUILDING") {
                throw new Error("Pod clusters can only be in BUILDING type locations");
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

        await PodCluster.deleteOne({ id: clusterId });

        return { message: "Pod cluster deleted successfully" };
    }
}

module.exports = new PodClusterService();
