const { Server } = require("socket.io");
const { randomBytes } = require("crypto");
const jwt = require("jsonwebtoken");
const PodQrCode = require("../models/PodQrCode");
const PodDevice = require("../models/PodDevice");
const Pod = require("../models/Pod");
const User = require("../models/User");

let ioInstance = null;
const qrRotationTimers = new Map();
const qrRotationLocks = new Set();

const QR_ROTATION_ENABLED = process.env.QR_ROTATION_ENABLED !== "false";
const QR_ROTATION_INTERVAL_SECONDS = Number(process.env.QR_ROTATION_INTERVAL_SECONDS || 30);

const createToken = () => randomBytes(16).toString("hex").toUpperCase();
const getPodRoom = (podId) => `pod:${podId}`;
const getCleanerRoom = (userId) => `cleaner:${userId}`;
const getUserRoom = (userId) => `user:${userId}`;

const normalizeCorsOrigins = () => {
    const envOrigins = process.env.SOCKET_CORS_ORIGIN;
    if (!envOrigins) return true;

    return envOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
};

const extractTokenFromHandshake = (socket) => {
    const authToken = String(socket?.handshake?.auth?.token || "").trim();
    if (authToken) {
        return authToken.startsWith("Bearer ") ? authToken.slice(7).trim() : authToken;
    }

    const headerAuth = String(socket?.handshake?.headers?.authorization || "").trim();
    if (headerAuth) {
        return headerAuth.startsWith("Bearer ") ? headerAuth.slice(7).trim() : headerAuth;
    }

    const queryToken = String(socket?.handshake?.query?.token || "").trim();
    if (queryToken) {
        return queryToken.startsWith("Bearer ") ? queryToken.slice(7).trim() : queryToken;
    }

    return null;
};

const resolveSocketAuthUser = async (socket) => {
    const token = extractTokenFromHandshake(socket);
    if (!token) {
        return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.id) {
        return null;
    }

    const user = await User.findById(decoded.id).select("_id role isActive id").lean();
    if (!user || !user.isActive) {
        return null;
    }

    return {
        id: String(user._id),
        role: String(user.role || "").toLowerCase(),
        public_id: user.id ? String(user.id) : null,
    };
};

const toQrPayload = (qrCode) => ({
    id: qrCode.id,
    pod_id: qrCode.pod_id,
    qr_token: qrCode.qr_token,
    expires_at: qrCode.expires_at,
    is_active: qrCode.is_active,
    createdAt: qrCode.createdAt,
    updatedAt: qrCode.updatedAt,
});

const sendLatestQrToSocket = async (socket, podId) => {
    if (!podId) {
        socket.emit("pod_qr_code:latest", { pod_id: null, qr_code: null });
        return;
    }

    const latestQr = await PodQrCode.findOne({
        pod_id: podId,
        is_active: true,
        expires_at: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    socket.emit("pod_qr_code:latest", {
        pod_id: podId,
        qr_code: latestQr ? toQrPayload(latestQr) : null,
    });
};

const getPodRoomClientCount = (podId) => {
    if (!ioInstance || !podId) return 0;
    const room = ioInstance.sockets.adapter.rooms.get(getPodRoom(podId));
    return room ? room.size : 0;
};

const getCleanerRoomClientCount = (userId) => {
    if (!ioInstance || !userId) return 0;
    const room = ioInstance.sockets.adapter.rooms.get(getCleanerRoom(userId));
    return room ? room.size : 0;
};

const rotateQrCodeForPod = async (podId) => {
    if (!ioInstance || !podId || !QR_ROTATION_ENABLED) return null;
    if (qrRotationLocks.has(podId)) return null;
    if (getPodRoomClientCount(podId) === 0) return null;

    qrRotationLocks.add(podId);

    try {
        await PodQrCode.updateMany({ pod_id: podId, is_active: true }, { $set: { is_active: false } });

        const expiresAt = new Date(Date.now() + QR_ROTATION_INTERVAL_SECONDS * 1000);
        const newQr = await PodQrCode.create({
            pod_id: podId,
            qr_token: createToken(),
            expires_at: expiresAt,
            is_active: true,
        });

        emitQrCodeEvent(newQr, "rotated");
        return newQr;
    } finally {
        qrRotationLocks.delete(podId);
    }
};

const stopRotationForPod = (podId) => {
    const timer = qrRotationTimers.get(podId);
    if (!timer) return;

    clearInterval(timer);
    qrRotationTimers.delete(podId);
};

const startRotationForPod = (podId) => {
    if (!podId || !QR_ROTATION_ENABLED || qrRotationTimers.has(podId)) return;

    rotateQrCodeForPod(podId).catch(() => null);

    const interval = setInterval(() => {
        rotateQrCodeForPod(podId).catch(() => null);
    }, QR_ROTATION_INTERVAL_SECONDS * 1000);

    qrRotationTimers.set(podId, interval);
};

const updateDeviceStatus = async (deviceId, status = {}) => {
    if (!deviceId) return;

    await PodDevice.updateOne(
        { device_id: deviceId },
        {
            $set: {
                ...status,
                last_ping: new Date(),
            },
        }
    );
};

const emitQrCodeEvent = (qrCode, action = "updated") => {
    if (!ioInstance || !qrCode || !qrCode.pod_id) return;

    ioInstance.to(`pod:${qrCode.pod_id}`).emit("pod_qr_code:updated", {
        action,
        qr_code: toQrPayload(qrCode),
        sent_at: new Date().toISOString(),
    });
};

const emitDoorUnlockRequest = ({ pod_id, payload = {} }) => {
    if (!ioInstance || !pod_id) return false;

    const room = getPodRoom(pod_id);
    ioInstance.to(room).emit("door:unlock_requested", {
        pod_id,
        requested_at: new Date().toISOString(),
        ...payload,
    });

    return getPodRoomClientCount(pod_id) > 0;
};

const emitPodCheckinConfirmed = ({
    pod_id,
    booking_id,
    customer_name = "Unknown",
    action = "SWITCH_TO_KEYPAD",
    session_expires_in = 300,
    retry_count = 2,
    retry_delay_ms = 300,
}) => {
    if (!ioInstance || !pod_id || !booking_id) return false;

    const room = getPodRoom(pod_id);
    const packet = {
        event: "POD_CHECKIN_CONFIRMED",
        payload: {
            pod_id,
            booking_id,
            customer_name,
            action,
            session_expires_in,
        },
    };

    const emitOnce = () => {
        ioInstance.to(room).emit("POD_CHECKIN_CONFIRMED", packet);
        return getPodRoomClientCount(pod_id) > 0;
    };

    const delivered = emitOnce();
    if (delivered || retry_count <= 0) {
        return delivered;
    }

    for (let attempt = 1; attempt <= retry_count; attempt += 1) {
        setTimeout(() => {
            emitOnce();
        }, attempt * retry_delay_ms);
    }

    return false;
};

const emitCleanerNotificationEvent = ({ user_id, notification = {} }) => {
    if (!ioInstance || !user_id || !notification || typeof notification !== "object") {
        return false;
    }

    const room = getCleanerRoom(user_id);
    ioInstance.to(room).emit("cleaner:notification", {
        user_id,
        sent_at: new Date().toISOString(),
        ...notification,
    });

    return getCleanerRoomClientCount(user_id) > 0;
};

const emitUserNotificationEvent = ({ user_id, notification = {} }) => {
    if (!ioInstance || !user_id || !notification || typeof notification !== "object") {
        return false;
    }

    const room = getUserRoom(user_id);
    ioInstance.to(room).emit("user:notification", {
        user_id,
        sent_at: new Date().toISOString(),
        ...notification,
    });

    const roomInfo = ioInstance.sockets.adapter.rooms.get(room);
    return roomInfo ? roomInfo.size > 0 : false;
};

const initSocketServer = (httpServer) => {
    if (ioInstance) return ioInstance;

    ioInstance = new Server(httpServer, {
        cors: {
            origin: normalizeCorsOrigins(),
            credentials: true,
        },
    });

    ioInstance.on("connection", (socket) => {
        let registeredDeviceId = null;
        let registeredPodId = null;
        let registeredCleanerId = null;
        let registeredUserId = null;
        let authenticatedUser = null;

        const registerDevice = async ({ device_id, pod_id } = {}) => {
            if (!device_id && !pod_id) {
                socket.emit("socket:error", { message: "device_id or pod_id is required" });
                return;
            }

            if (device_id) {
                registeredDeviceId = device_id;
                socket.join(`device:${device_id}`);
                await updateDeviceStatus(device_id, { is_online: true });
            }

            if (pod_id) {
                const pod = await Pod.findOne({ id: pod_id }).select("id");
                if (!pod) {
                    throw new Error("Pod not found");
                }

                if (registeredPodId && registeredPodId !== pod_id) {
                    socket.leave(getPodRoom(registeredPodId));
                    if (getPodRoomClientCount(registeredPodId) === 0) {
                        stopRotationForPod(registeredPodId);
                    }
                }

                registeredPodId = pod_id;
                socket.join(getPodRoom(pod_id));
                await sendLatestQrToSocket(socket, pod_id);
                startRotationForPod(pod_id);
            }

            socket.emit("device:registered", {
                device_id: registeredDeviceId,
                pod_id: registeredPodId,
            });
        };

        const registerCleaner = async ({ cleaner_id, user_id } = {}) => {
            if (!authenticatedUser) {
                authenticatedUser = await resolveSocketAuthUser(socket);
            }

            if (!authenticatedUser) {
                socket.emit("socket:error", { message: "Unauthorized cleaner subscription" });
                return;
            }

            if (authenticatedUser.role !== "cleaner") {
                socket.emit("socket:error", { message: "Only cleaner role can subscribe cleaner room" });
                return;
            }

            const requestedCleanerId = String(cleaner_id || user_id || "").trim();
            if (
                requestedCleanerId &&
                requestedCleanerId !== authenticatedUser.id &&
                requestedCleanerId !== String(authenticatedUser.public_id || "")
            ) {
                socket.emit("socket:error", { message: "Cleaner room subscription mismatch" });
                return;
            }

            const resolvedCleanerId = authenticatedUser.id;

            if (registeredCleanerId && registeredCleanerId !== resolvedCleanerId) {
                socket.leave(getCleanerRoom(registeredCleanerId));
            }

            registeredCleanerId = resolvedCleanerId;
            socket.join(getCleanerRoom(registeredCleanerId));

            socket.emit("cleaner:subscribed", {
                user_id: registeredCleanerId,
            });
        };

        const registerUser = async (payload = {}) => {
            if (!authenticatedUser) {
                authenticatedUser = await resolveSocketAuthUser(socket);
            }

            if (!authenticatedUser) {
                socket.emit("socket:error", { message: "Unauthorized user subscription" });
                return;
            }

            const requestedUserId = String(payload.user_id || "").trim();
            if (
                requestedUserId &&
                requestedUserId !== authenticatedUser.id &&
                requestedUserId !== String(authenticatedUser.public_id || "")
            ) {
                socket.emit("socket:error", { message: "User room subscription mismatch" });
                return;
            }

            const resolvedUserId = authenticatedUser.id;

            if (registeredUserId && registeredUserId !== resolvedUserId) {
                socket.leave(getUserRoom(registeredUserId));
            }

            registeredUserId = resolvedUserId;
            socket.join(getUserRoom(registeredUserId));

            socket.emit("user:subscribed", {
                user_id: registeredUserId,
            });
        };

        const handshakeData = {
            ...(socket.handshake.auth || {}),
            ...(socket.handshake.query || {}),
        };

        if (handshakeData.device_id || handshakeData.pod_id) {
            registerDevice(handshakeData).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to register device" });
            });
        }

        if (handshakeData.cleaner_id) {
            registerCleaner(handshakeData).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to subscribe cleaner room" });
                socket.disconnect(true);
            });
        }

        if (handshakeData.user_id) {
            registerUser(handshakeData).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to subscribe user room" });
            });
        }

        socket.on("device:register", (data) => {
            registerDevice(data).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to register device" });
            });
        });

        socket.on("pod:subscribe", ({ pod_id } = {}) => {
            registerDevice({ pod_id }).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to subscribe pod" });
            });
        });

        socket.on("pod_qr_code:request_latest", ({ pod_id } = {}) => {
            sendLatestQrToSocket(socket, pod_id).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to fetch latest QR" });
            });
        });

        socket.on("cleaner:subscribe", (data = {}) => {
            registerCleaner(data).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to subscribe cleaner room" });
            });
        });

        socket.on("user:subscribe", (data = {}) => {
            registerUser(data).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to subscribe user room" });
            });
        });

        socket.on("device:ping", () => {
            updateDeviceStatus(registeredDeviceId, { is_online: true }).catch(() => null);
        });

        socket.on("disconnect", () => {
            updateDeviceStatus(registeredDeviceId, { is_online: false }).catch(() => null);

            if (registeredPodId && getPodRoomClientCount(registeredPodId) === 0) {
                stopRotationForPod(registeredPodId);
            }
        });
    });

    return ioInstance;
};

const getSocketServer = () => ioInstance;

const emitDashboardRefreshEvent = () => {
    if (!ioInstance) return;
    ioInstance.emit("dashboard:refresh", {
        type: "SYSTEM_REFRESH",
        timestamp: new Date().toISOString()
    });
};

module.exports = {
    initSocketServer,
    getSocketServer,
    emitQrCodeEvent,
    emitDoorUnlockRequest,
    emitPodCheckinConfirmed,
    emitCleanerNotificationEvent,
    emitUserNotificationEvent,
    emitDashboardRefreshEvent,
};
