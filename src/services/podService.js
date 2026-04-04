const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Booking = require("../models/Bookings");
const BookingSlot = require("../models/BookingSlot");
const TimeSlot = require("../models/TimeSlot");
const BookingAccessSession = require("../models/BookingAccessSession");
const OnlineKey = require("../models/OnlineKey");
const Door = require("../models/Door");
const PodDevice = require("../models/PodDevice");
const Incident = require("../models/Incidents");
const User = require("../models/User");
const notificationService = require("./notificationService");
const podQrCodeService = require("../services/podQrCodeService");

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
    async _notifyMigrationAlerts({ podId, alerts = [] }) {
        if (!alerts.length) return;

        const recipients = await User.find({
            role: { $in: ["admin", "manager"] },
            isActive: true,
        }).select("_id").lean();

        if (!recipients.length) return;

        await Promise.all(
            recipients.map((item) =>
                notificationService.sendToUser(item._id, {
                    title: "Auto migration alert",
                    message: `No replacement pod found for ${alerts.length} future booking(s) on maintenance pod ${podId}`,
                    type: "POD",
                    event_code: "POD_AUTO_MIGRATION_ALERT",
                    dedupe_key: `POD_AUTO_MIGRATION_ALERT:${podId}:${item._id}`,
                    data: {
                        pod_id: podId,
                        alert_count: alerts.length,
                    },
                })
            )
        );
    }

    async _findReplacementPodForBooking(booking, candidatePods = []) {
        for (const candidatePod of candidatePods) {
            const isAvailable = await Booking.isPodAvailable(
                candidatePod.id,
                booking.start_time,
                booking.end_time,
                booking.id
            );

            if (!isAvailable) {
                continue;
            }

            const conflictingTimeSlot = await TimeSlot.findOne({
                pod_id: candidatePod.id,
                status: "RESERVED",
                start_time: { $lt: booking.end_time },
                end_time: { $gt: booking.start_time },
            })
                .select("id")
                .lean();

            if (conflictingTimeSlot) {
                continue;
            }

            return candidatePod;
        }

        return null;
    }

    async _autoMigrateFutureBookingsForMaintenancePod(pod) {
        const now = new Date();

        const futureBookings = await Booking.find({
            pod_id: pod.id,
            status: "BOOKED",
            start_time: { $gt: now },
        }).sort({ start_time: 1 });

        if (futureBookings.length === 0) {
            return {
                scanned: 0,
                migrated_count: 0,
                alert_count: 0,
                migrated: [],
                alerts: [],
            };
        }

        const candidatePods = await Pod.find({
            cluster_id: pod.cluster_id,
            status: "AVAILABLE",
            id: { $ne: pod.id },
        })
            .select("id code name cluster_id")
            .lean();

        const migrated = [];
        const alerts = [];

        for (const booking of futureBookings) {
            const targetPod = await this._findReplacementPodForBooking(booking, candidatePods);

            if (!targetPod) {
                alerts.push({
                    booking_id: booking.id,
                    reason: "NO_AVAILABLE_POD_IN_CLUSTER",
                });
                continue;
            }

            const oldPodId = booking.pod_id;
            booking.pod_id = targetPod.id;
            await booking.save();

            const bookingSlots = await BookingSlot.find({ booking_id: booking.id }).select("time_slot_id").lean();
            const timeSlotIds = bookingSlots.map((slot) => slot.time_slot_id);

            if (timeSlotIds.length > 0) {
                await TimeSlot.updateMany(
                    { id: { $in: timeSlotIds } },
                    { $set: { pod_id: targetPod.id } }
                );
            }

            await OnlineKey.updateMany(
                { booking_id: booking.id, is_revoked: false },
                { $set: { pod_id: targetPod.id } }
            );

            migrated.push({
                booking_id: booking.id,
                from_pod_id: oldPodId,
                to_pod_id: targetPod.id,
            });

            await notificationService.sendToUser(booking.user_id, {
                title: "Booking pod updated",
                message: "Your upcoming booking was moved to another available pod due to maintenance.",
                type: "BOOKING",
                event_code: "BOOKING_AUTO_MIGRATED",
                dedupe_key: `BOOKING_AUTO_MIGRATED:${booking.id}`,
                data: {
                    booking_id: booking.id,
                    old_pod_id: oldPodId,
                    new_pod_id: targetPod.id,
                },
            });
        }

        if (alerts.length > 0) {
            await this._notifyMigrationAlerts({ podId: pod.id, alerts });
        }

        return {
            scanned: futureBookings.length,
            migrated_count: migrated.length,
            alert_count: alerts.length,
            migrated,
            alerts,
        };
    }

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

        // Provision 1-1 door records for newly created pods
        const createdPodIds = createdPods.map((p) => p.id);
        const existingDoors = await Door.find({ pod_id: { $in: createdPodIds } }).select("pod_id").lean();
        const existingDoorPodIds = new Set(existingDoors.map((d) => d.pod_id));
        const doorsToCreate = createdPodIds
            .filter((podId) => !existingDoorPodIds.has(podId))
            .map((podId) => ({
                pod_id: podId,
                lock_status: "LOCKED",
                door_sensor: "CLOSED",
            }));

        if (doorsToCreate.length > 0) {
            await Door.insertMany(doorsToCreate);
        }

        // Provision PodDevices for newly created pods
        const devicesToCreate = createdPods.map((pod) => ({
            pod_id: pod.id,
            device_name: `Pod Device ${pod.code}`,
            device_id: `PODDEV-${pod.code}-${pod.id.slice(0, 8)}`.toUpperCase(),
            auth_token: null,
            is_online: false,
            last_ping: null,
        }));

        if (devicesToCreate.length > 0) {
            await PodDevice.insertMany(devicesToCreate);
        }

        // Provision QR codes for newly created pods
        for (const pod of createdPods) {
            try {
                await podQrCodeService.createQrCode({
                    pod_id: pod.id,
                    qr_token: null, // Generate token internally if null
                    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year expiry
                    is_active: true,
                });
            } catch (error) {
                console.error(`Failed to create QR code for pod ${pod.id}:`, error.message);
            }
        }

        return createdPods;
    }

    /**
     * Lấy tất cả pods với filters
     */
    async getAllPods({ cluster_id, status, code, pod_ids }) {
        const filter = {};

        if (cluster_id) filter.cluster_id = cluster_id;
        if (status) filter.status = status;
        if (code) filter.code = new RegExp(code, "i");

        // If pod_ids is provided (from manager scope), filter by those IDs
        if (pod_ids) {
            const podIdArray = pod_ids.split(",").filter(Boolean);
            if (podIdArray.length > 0) {
                filter.id = { $in: podIdArray };
            }
        }

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
    async getPodsByCluster(clusterId, pod_ids) {
        const pods = await Pod.getByCluster(clusterId);

        // If pod_ids is provided (from manager scope), filter by those IDs
        if (pod_ids) {
            const podIdArray = pod_ids.split(",").filter(Boolean);
            if (podIdArray.length > 0) {
                return pods.filter(pod => podIdArray.includes(String(pod.id)));
            }
        }

        return pods;
    }

    /**
     * Lấy pods available theo cluster
     */
    async getAvailablePodsByCluster(clusterId, pod_ids) {
        const pods = await Pod.getAvailable(clusterId || null);

        // If pod_ids is provided (from manager scope), filter by those IDs
        if (pod_ids) {
            const podIdArray = pod_ids.split(",").filter(Boolean);
            if (podIdArray.length > 0) {
                return pods.filter(pod => podIdArray.includes(String(pod.id)));
            }
        }

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
    async updatePodStatus(podId, { status, maintenance_status, long_term_maintenance = false, auto_migrate_future_bookings = false }) {
        if (!status) {
            throw new Error("Status is required");
        }

        const validStatuses = ["AVAILABLE", "OCCUPIED", "NEEDS_CLEANING", "CLEANING", "MAINTENANCE"];
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
        if (status === "MAINTENANCE") {
            pod.maintenance_status = maintenance_status || pod.maintenance_status;
        }
        await pod.save();
        await pod.populate("cluster");

        let autoMigration = null;
        if (
            status === "MAINTENANCE" &&
            (auto_migrate_future_bookings === true || String(auto_migrate_future_bookings).toLowerCase() === "true" ||
                long_term_maintenance === true || String(long_term_maintenance).toLowerCase() === "true")
        ) {
            autoMigration = await this._autoMigrateFutureBookingsForMaintenancePod(pod);
        }

        const result = pod.toObject ? pod.toObject() : pod;
        if (autoMigration) {
            result.auto_migration = autoMigration;
        }

        return result;
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

        // Chặn xóa nếu đã có booking gắn với pod để tránh mồ côi dữ liệu lịch sử
        const bookingCount = await Booking.countDocuments({ pod_id: podId });
        if (bookingCount > 0) {
            const error = new Error("Cannot delete pod because bookings already exist for this pod");
            error.statusCode = 400;
            throw error;
        }

        // Chặn xóa nếu có phiên truy cập hoặc online key còn hiệu lực
        const [accessSessionCount, activeKeyCount] = await Promise.all([
            BookingAccessSession.countDocuments({ pod_id: podId }),
            OnlineKey.countDocuments({ pod_id: podId, is_revoked: false }),
        ]);

        if (accessSessionCount > 0) {
            const error = new Error("Cannot delete pod because access sessions exist for this pod");
            error.statusCode = 400;
            throw error;
        }

        if (activeKeyCount > 0) {
            const error = new Error("Cannot delete pod because active online keys exist for this pod");
            error.statusCode = 400;
            throw error;
        }

        // Chặn xóa khi còn incident chưa đóng
        const openIncidentCount = await Incident.countDocuments({
            $or: [{ pod_id: podId }, { podId: podId }],
            status: { $in: ["PENDING", "INVESTIGATING"] },
        });
        if (openIncidentCount > 0) {
            const error = new Error("Cannot delete pod because unresolved incidents exist for this pod");
            error.statusCode = 400;
            throw error;
        }

        // Dọn dữ liệu phụ trợ an toàn trước khi xóa pod
        await Promise.all([
            TimeSlot.deleteMany({ pod_id: podId }),
            Door.deleteMany({ pod_id: podId }),
            OnlineKey.deleteMany({ pod_id: podId }),
            Incident.deleteMany({ $or: [{ pod_id: podId }, { podId: podId }] }),
        ]);

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
