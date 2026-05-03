const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Cloudinary storage for PodCluster images
const podClusterStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "oasisgo/pod-clusters",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1200, height: 800, crop: "limit" }],
  },
});

// Multer upload instances
const uploadPodClusterImage = multer({
  storage: podClusterStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

const cleaningTaskMediaStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const isVideo = String(file.mimetype || "").toLowerCase().startsWith("video/");
    return {
      folder: "oasisgo/cleaning-tasks",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: isVideo
        ? ["mp4", "mov", "avi", "webm", "mkv"]
        : ["jpg", "jpeg", "png", "webp"],
      ...(isVideo ? {} : { transformation: [{ width: 1600, height: 1600, crop: "limit" }] }),
    };
  },
});

const uploadCleaningTaskMedia = multer({
  storage: cleaningTaskMediaStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB to support video
  },
});

const lostFoundMediaStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const isVideo = String(file.mimetype || "").toLowerCase().startsWith("video/");
    return {
      folder: "oasisgo/lost-found-media",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: isVideo
        ? ["mp4", "mov", "avi", "webm", "mkv"]
        : ["jpg", "jpeg", "png", "webp"],
      ...(isVideo ? {} : { transformation: [{ width: 1600, height: 1600, crop: "limit" }] }),
    };
  },
});

const uploadLostFoundMedia = multer({
  storage: lostFoundMediaStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB to support video
  },
});

const incidentMediaStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const isVideo = String(file.mimetype || "").toLowerCase().startsWith("video/");
    return {
      folder: "oasisgo/incidents",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: isVideo
        ? ["mp4", "mov", "avi", "webm", "mkv"]
        : ["jpg", "jpeg", "png", "webp"],
      ...(isVideo ? {} : { transformation: [{ width: 1600, height: 1600, crop: "limit" }] }),
    };
  },
});

const uploadIncidentMedia = multer({
  storage: incidentMediaStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB to support video
  },
});

module.exports = {
  cloudinary,
  uploadPodClusterImage,
  uploadCleaningTaskMedia,
  uploadCleaningTaskPhoto: uploadCleaningTaskMedia, // backward-compat alias
  uploadLostFoundMedia,
  uploadIncidentMedia,
  uploadIncidentPhoto: uploadIncidentMedia, // backward-compat alias
};
