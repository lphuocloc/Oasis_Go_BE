const Location = require("../models/Location");
const PodCluster = require("../models/PodCluster");

// Location Type Hierarchy Configuration
// Định nghĩa quan hệ cha → con được phép
const LOCATION_HIERARCHY = {
    airport: ["terminal"],           // Sân bay → Terminal
    terminal: [],                    // Terminal không có con (leaf, chứa pod clusters)
    mall: ["floor"],                 // Mall → Tầng
    floor: [],                       // Floor không có con (leaf, chứa pod clusters)
    bus_station: ["waiting_lounge"], // Bến xe → Phòng chờ
    waiting_lounge: [],              // Phòng chờ không có con (leaf, chứa pod clusters)
};

// Root types: có thể tồn tại mà không cần parent
const ROOT_TYPES = ["airport", "mall", "bus_station"];

// Leaf types: không có con, chỉ chứa pod clusters
const LEAF_TYPES = ["terminal", "floor", "waiting_lounge"];

// Tất cả types hợp lệ (phải sync với Model enum)
const VALID_TYPES = Object.keys(LOCATION_HIERARCHY);

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

        // Validate type có trong danh sách hợp lệ (từ Model enum)
        if (!VALID_TYPES.includes(type)) {
            throw new Error(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`);
        }

        // Validate parent hierarchy
        if (parent_id) {
            const parent = await Location.findOne({ id: parent_id });
            if (!parent) {
                const error = new Error("Parent location not found");
                error.statusCode = 404;
                throw error;
            }

            // Kiểm tra type của con có hợp lệ với cha không (dựa vào LOCATION_HIERARCHY)
            const allowedChildTypes = LOCATION_HIERARCHY[parent.type];
            if (!allowedChildTypes.includes(type)) {
                throw new Error(
                    `Invalid hierarchy: ${parent.type} can only have children of type: ${allowedChildTypes.join(", ") || "none"}`
                );
            }
        } else {
            // Nếu không có parent, chỉ các root types mới được phép
            if (!ROOT_TYPES.includes(type)) {
                throw new Error(`Only ${ROOT_TYPES.join(", ")} types can have no parent`);
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
            if (!VALID_TYPES.includes(type)) {
                throw new Error(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`);
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

// Export service và constants
module.exports = new LocationService();
module.exports.LOCATION_HIERARCHY = LOCATION_HIERARCHY;
module.exports.ROOT_TYPES = ROOT_TYPES;
module.exports.LEAF_TYPES = LEAF_TYPES;
module.exports.VALID_TYPES = VALID_TYPES;
