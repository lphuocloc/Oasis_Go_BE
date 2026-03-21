const { Server } = require("socket.io");
const { randomBytes } = require("crypto");
const PodQrCode = require("../models/PodQrCode");
const PodDevice = require("../models/PodDevice");
const Pod = require("../models/Pod");

let ioInstance = null;
const qrRotationTimers = new Map();
const qrRotationLocks = new Set();

const QR_ROTATION_ENABLED = process.env.QR_ROTATION_ENABLED !== "false";
const QR_ROTATION_INTERVAL_SECONDS = Number(process.env.QR_ROTATION_INTERVAL_SECONDS || 30);

const createToken = () => randomBytes(16).toString("hex").toUpperCase();
const getPodRoom = (podId) => `pod:${podId}`;

const normalizeCorsOrigins = () => {
    const envOrigins = process.env.SOCKET_CORS_ORIGIN;
    if (!envOrigins) return true;

    return envOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
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

        const handshakeData = {
            ...(socket.handshake.auth || {}),
            ...(socket.handshake.query || {}),
        };

        if (handshakeData.device_id || handshakeData.pod_id) {
            registerDevice(handshakeData).catch((error) => {
                socket.emit("socket:error", { message: error.message || "Failed to register device" });
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

module.exports = {
    initSocketServer,
    getSocketServer,
    emitQrCodeEvent,
};
