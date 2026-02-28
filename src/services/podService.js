const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");

/**
 * Helper function to generate row letter from index
 * 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, 27 -> AB, etc.
 */
const getRowLetter = (index) => {
    let letter = "";
    while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
};

/**
 * Helper function to generate pod code
 * Format: [RowLetter][ColNumber][Level]
 * Example: A01L, A01U, B05L, B05U
 */
const generatePodCode = (rowIndex, colIndex, level) => {
    const rowLetter = getRowLetter(rowIndex);
    const colNumber = String(colIndex + 1).padStart(2, "0");
    return `${rowLetter}${colNumber}${level}`;
};

class PodService {
    /**
     * Tạo pods (Grid hoặc Single mode)
     */
    async createPods(data) {
        const {
            cluster_id,
            numRows,
            numCols,
            code,
            name,
            description,
            soundproof_level,
            ventilation_level,
            power_outlets,
            wifi_available,
            max_session_duration,
        } = data;

        // Validate cluster_id
        if (!cluster_id) {
            throw new Error("Cluster ID is required");
        }

        // Validate cluster exists
        const cluster = await PodCluster.findOne({ id: cluster_id });
        if (!cluster) {
            const error = new Error("Pod cluster not found");
            error.statusCode = 404;
            throw error;
        }

        // Default values for pod amenities
        const defaultValues = {
            soundproof_level: soundproof_level || 3,
            ventilation_level: ventilation_level || 3,
            power_outlets: power_outlets || 2,
            wifi_available: wifi_available !== undefined ? wifi_available : true,
            max_session_duration: max_session_duration || 480,
            status: "AVAILABLE",
        };

        let podsToCreate = [];

        // Constants for Grid limitations
        const MAX_ROWS = 10;
        const MAX_COLS = 20;
        const MAX_TOTAL_PODS = 200;

        // MODE 1: Grid Creation
        if (numRows && numCols) {
            if (numRows <= 0 || numCols <= 0) {
                throw new Error("Number of rows and columns must be positive integers");
            }

            // Validate max rows and columns
            if (numRows > MAX_ROWS) {
                throw new Error(`Number of rows cannot exceed ${MAX_ROWS}`);
            }

            if (numCols > MAX_COLS) {
                throw new Error(`Number of columns cannot exceed ${MAX_COLS}`);
            }

            // Validate total pods (2 levels per position)
            const totalPods = numRows * numCols * 2;
            if (totalPods > MAX_TOTAL_PODS) {
                throw new Error(`Total pods cannot exceed ${MAX_TOTAL_PODS}. Current: ${totalPods}`);
            }

            // Generate grid pods
            for (let row = 0; row < numRows; row++) {
                for (let col = 0; col < numCols; col++) {
                    // Lower level pod
                    const lowerCode = generatePodCode(row, col, "L");
                    podsToCreate.push({
                        cluster_id,
                        code: lowerCode,
                        name: `Pod ${lowerCode}`,
                        description: description || `Grid pod at row ${row + 1}, col ${col + 1}, lower level`,
                        ...defaultValues,
                    });

                    // Upper level pod
                    const upperCode = generatePodCode(row, col, "U");
                    podsToCreate.push({
                        cluster_id,
                        code: upperCode,
                        name: `Pod ${upperCode}`,
                        description: description || `Grid pod at row ${row + 1}, col ${col + 1}, upper level`,
                        ...defaultValues,
                    });
                }
            }
        }
        // MODE 2: Single Pod Creation
        else if (code && name) {
            // Validate code is unique in cluster
            const existingPod = await Pod.findOne({ cluster_id, code });
            if (existingPod) {
                const error = new Error(`Pod with code "${code}" already exists in this cluster`);
                error.statusCode = 409;
                throw error;
            }

            podsToCreate.push({
                cluster_id,
                code,
                name,
                description: description || "",
                ...defaultValues,
            });
        } else {
            throw new Error("Either (numRows and numCols) for grid creation OR (code and name) for single creation must be provided");
        }

        // Check for duplicate codes in the batch
        const codes = podsToCreate.map((pod) => pod.code);
        const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
        if (duplicates.length > 0) {
            throw new Error(`Duplicate pod codes detected: ${duplicates.join(", ")}`);
        }

        // Check if any code already exists in cluster
        const existingCodes = await Pod.find({
            cluster_id,
            code: { $in: codes },
        }).select("code");

        if (existingCodes.length > 0) {
            const existing = existingCodes.map((pod) => pod.code).join(", ");
            const error = new Error(`The following pod codes already exist in this cluster: ${existing}`);
            error.statusCode = 409;
            throw error;
        }

        // Bulk insert
        const createdPods = await Pod.insertMany(podsToCreate);

        return createdPods;
    }

    /**
     * Lấy tất cả pods với filters
     */
    async getAllPods({ cluster_id, status, code }) {
        const filter = {};

        if (cluster_id) filter.cluster_id = cluster_id;
        if (status) filter.status = status;
        if (code) filter.code = new RegExp(code, "i");

        const pods = await Pod.find(filter)
            .populate("cluster")
            .sort({ code: 1 });

        return pods;
    }

    /**
     * Lấy pod theo ID
     */
    async getPodById(podId) {
        const pod = await Pod.findOne({ id: podId }).populate("cluster");

        if (!pod) {
            const error = new Error("Pod not found");
            error.statusCode = 404;
            throw error;
        }

        return pod;
    }

    /**
     * Lấy pods theo cluster
     */
    async getPodsByCluster(clusterId) {
        const pods = await Pod.getByCluster(clusterId);
        return pods;
    }

    /**
     * Lấy pods available theo cluster
     */
    async getAvailablePodsByCluster(clusterId) {
        const pods = await Pod.getAvailableByCluster(clusterId);
        return pods;
    }

    /**
     * Cập nhật pod
     */
    async updatePod(podId, updates) {
        const {
            cluster_id,
            code,
            name,
            description,
            soundproof_level,
            ventilation_level,
            power_outlets,
            wifi_available,
            max_session_duration,
            status,
        } = updates;

        const pod = await Pod.findOne({ id: podId });
        if (!pod) {
            const error = new Error("Pod not found");
            error.statusCode = 404;
            throw error;
        }

        // Validate cluster if changing
        if (cluster_id && cluster_id !== pod.cluster_id) {
            const cluster = await PodCluster.findOne({ id: cluster_id });
            if (!cluster) {
                const error = new Error("Pod cluster not found");
                error.statusCode = 404;
                throw error;
            }

            // Check if code exists in new cluster
            if (code || pod.code) {
                const existingPod = await Pod.findOne({
                    cluster_id,
                    code: code || pod.code,
                    id: { $ne: podId },
                });
                if (existingPod) {
                    const error = new Error(`Pod with code "${code || pod.code}" already exists in the target cluster`);
                    error.statusCode = 409;
                    throw error;
                }
            }

            pod.cluster_id = cluster_id;
        }

        // Validate code uniqueness if changing
        if (code && code !== pod.code) {
            const existingPod = await Pod.findOne({
                cluster_id: pod.cluster_id,
                code,
                id: { $ne: podId },
            });
            if (existingPod) {
                const error = new Error(`Pod with code "${code}" already exists in this cluster`);
                error.statusCode = 409;
                throw error;
            }
            pod.code = code;
        }

        // Update fields
        if (name) pod.name = name;
        if (description !== undefined) pod.description = description;
        if (soundproof_level !== undefined) pod.soundproof_level = soundproof_level;
        if (ventilation_level !== undefined) pod.ventilation_level = ventilation_level;
        if (power_outlets !== undefined) pod.power_outlets = power_outlets;
        if (wifi_available !== undefined) pod.wifi_available = wifi_available;
        if (max_session_duration !== undefined) pod.max_session_duration = max_session_duration;
        if (status) pod.status = status;

        await pod.save();
        await pod.populate("cluster");

        return pod;
    }

    /**
     * Cập nhật trạng thái pod
     */
    async updatePodStatus(podId, { status }) {
        if (!status) {
            throw new Error("Status is required");
        }

        const validStatuses = ["AVAILABLE", "OCCUPIED", "MAINTENANCE", "OUT_OF_SERVICE"];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
        }

        const pod = await Pod.findOne({ id: podId });
        if (!pod) {
            const error = new Error("Pod not found");
            error.statusCode = 404;
            throw error;
        }

        pod.status = status;
        await pod.save();
        await pod.populate("cluster");

        return pod;
    }

    /**
     * Xóa pod
     */
    async deletePod(podId) {
        const pod = await Pod.findOne({ id: podId });
        if (!pod) {
            const error = new Error("Pod not found");
            error.statusCode = 404;
            throw error;
        }

        // Kiểm tra pod có đang được sử dụng không
        if (pod.status === "OCCUPIED") {
            const error = new Error("Cannot delete a pod that is currently occupied");
            error.statusCode = 400;
            throw error;
        }

        await Pod.deleteOne({ id: podId });

        return { message: "Pod deleted successfully" };
    }

    /**
     * Xóa nhiều pods
     */
    async deleteManyPods({ cluster_id, codes }) {
        const filter = {};

        if (cluster_id) filter.cluster_id = cluster_id;
        if (codes && codes.length > 0) filter.code = { $in: codes };

        // Kiểm tra có pods đang occupied không
        const occupiedPods = await Pod.find({ ...filter, status: "OCCUPIED" });
        if (occupiedPods.length > 0) {
            const occupiedCodes = occupiedPods.map((pod) => pod.code).join(", ");
            const error = new Error(`Cannot delete occupied pods: ${occupiedCodes}`);
            error.statusCode = 400;
            throw error;
        }

        const result = await Pod.deleteMany(filter);

        return {
            message: `${result.deletedCount} pod(s) deleted successfully`,
            deletedCount: result.deletedCount,
        };
    }
}

module.exports = new PodService();
