const Location = require("../models/Location");
const PodCluster = require("../models/PodCluster");

class LocationService {
    /**
     * Lấy tất cả locations với filters
     */
    async getAllLocations({ type, parent_id, isActive }) {
        const filter = {};

        if (type) filter.type = type;
        if (parent_id !== undefined) {
            filter.parent_id = parent_id === "null" ? null : parent_id;
        }
        if (isActive !== undefined) filter.isActive = isActive === "true";

        const locations = await Location.find(filter).sort({ createdAt: -1 });

        return locations;
    }

    /**
     * Lấy location theo ID
     */
    async getLocationById(locationId) {
        const location = await Location.findOne({ id: locationId });

        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }

        return location;
    }

    /**
     * Lấy location tree/hierarchy
     */
    async getLocationTree(rootId = null) {
        const tree = await Location.getTree(rootId);
        return tree;
    }

    /**
     * Lấy location hierarchy path
     */
    async getLocationPath(locationId) {
        const path = await Location.getPath(locationId);

        if (!path || path.length === 0) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }

        return path;
    }

    /**
     * Tạo location mới
     */
    async createLocation({ type, name, description, parent_id, address, isActive }) {
        // Validate required fields
        if (!type || !name) {
            throw new Error("Type and name are required");
        }

        // Validate type
        const validTypes = ["COUNTRY", "PROVINCE", "DISTRICT", "BUILDING"];
        if (!validTypes.includes(type)) {
            throw new Error(`Invalid type. Must be one of: ${validTypes.join(", ")}`);
        }

        // Validate parent hierarchy
        if (parent_id) {
            const parent = await Location.findOne({ id: parent_id });
            if (!parent) {
                const error = new Error("Parent location not found");
                error.statusCode = 404;
                throw error;
            }

            // Check valid hierarchy
            const validHierarchy = {
                COUNTRY: ["PROVINCE"],
                PROVINCE: ["DISTRICT"],
                DISTRICT: ["BUILDING"],
                BUILDING: [],
            };

            if (!validHierarchy[parent.type].includes(type)) {
                throw new Error(
                    `Invalid hierarchy: ${parent.type} can only have children of type: ${validHierarchy[parent.type].join(", ")}`
                );
            }
        } else {
            // Nếu không có parent, phải là COUNTRY
            if (type !== "COUNTRY") {
                throw new Error("Only COUNTRY type can have no parent");
            }
        }

        // Create location
        const location = await Location.create({
            type,
            name,
            description,
            parent_id: parent_id || null,
            address,
            isActive: isActive !== undefined ? isActive : true,
        });

        return location;
    }

    /**
     * Cập nhật location
     */
    async updateLocation(locationId, updates) {
        const { type, name, description, parent_id, address, isActive } = updates;

        const location = await Location.findOne({ id: locationId });
        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }

        // Validate type if changing
        if (type && type !== location.type) {
            const validTypes = ["COUNTRY", "PROVINCE", "DISTRICT", "BUILDING"];
            if (!validTypes.includes(type)) {
                throw new Error(`Invalid type. Must be one of: ${validTypes.join(", ")}`);
            }
        }

        // Update fields
        if (type) location.type = type;
        if (name) location.name = name;
        if (description !== undefined) location.description = description;
        if (parent_id !== undefined) location.parent_id = parent_id;
        if (address !== undefined) location.address = address;
        if (isActive !== undefined) location.isActive = isActive;

        await location.save();

        return location;
    }

    /**
     * Xóa location
     */
    async deleteLocation(locationId) {
        const location = await Location.findOne({ id: locationId });
        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }

        // Kiểm tra có children không
        const children = await Location.find({ parent_id: locationId });
        if (children.length > 0) {
            const error = new Error("Cannot delete location with children. Delete children first.");
            error.statusCode = 400;
            throw error;
        }

        // Kiểm tra có pod clusters không
        const podClusters = await PodCluster.find({ location_id: locationId });
        if (podClusters.length > 0) {
            const error = new Error("Cannot delete location with pod clusters. Delete pod clusters first.");
            error.statusCode = 400;
            throw error;
        }

        await Location.deleteOne({ id: locationId });

        return { message: "Location deleted successfully" };
    }

    /**
     * Toggle trạng thái active của location
     */
    async toggleLocationStatus(locationId) {
        const location = await Location.findOne({ id: locationId });
        if (!location) {
            const error = new Error("Location not found");
            error.statusCode = 404;
            throw error;
        }

        location.isActive = !location.isActive;
        await location.save();

        return location;
    }
}

module.exports = new LocationService();
