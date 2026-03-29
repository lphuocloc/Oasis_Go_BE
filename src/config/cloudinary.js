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

const cleaningTaskPhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "oasisgo/cleaning-tasks",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1600, height: 1600, crop: "limit" }],
  },
});

const uploadCleaningTaskPhoto = multer({
  storage: cleaningTaskPhotoStorage,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB
  },
});

const incidentPhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "oasisgo/incidents",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1600, height: 1600, crop: "limit" }],
  },
});

const uploadIncidentPhoto = multer({
  storage: incidentPhotoStorage,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB
  },
});

module.exports = {
  cloudinary,
  uploadPodClusterImage,
  uploadCleaningTaskPhoto,
  uploadIncidentPhoto,
};
