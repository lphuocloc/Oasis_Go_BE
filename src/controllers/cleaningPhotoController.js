const cleaningPhotoService = require("../services/cleaningPhotoService");

exports.createCleaningPhoto = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      photo_url: req.file ? req.file.path : req.body.photo_url,
      photo_public_id: req.file ? req.file.filename : req.body.photo_public_id,
    };

    const photo = await cleaningPhotoService.createCleaningPhoto(payload);
    res.status(201).json({ success: true, message: "Cleaning photo created successfully", data: photo });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating cleaning photo" });
  }
};

exports.getAllCleaningPhotos = async (req, res) => {
  try {
    const photos = await cleaningPhotoService.getAllCleaningPhotos(req.query);
    res.status(200).json({ success: true, count: photos.length, data: photos });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning photos" });
  }
};

exports.getCleaningPhotoById = async (req, res) => {
  try {
    const photo = await cleaningPhotoService.getCleaningPhotoById(req.params.id);
    res.status(200).json({ success: true, data: photo });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning photo" });
  }
};

exports.updateCleaningPhoto = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      photo_url: req.file ? req.file.path : req.body.photo_url,
      photo_public_id: req.file ? req.file.filename : req.body.photo_public_id,
    };

    const photo = await cleaningPhotoService.updateCleaningPhoto(req.params.id, payload);
    res.status(200).json({ success: true, message: "Cleaning photo updated successfully", data: photo });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating cleaning photo" });
  }
};

exports.deleteCleaningPhoto = async (req, res) => {
  try {
    const result = await cleaningPhotoService.deleteCleaningPhoto(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting cleaning photo" });
  }
};
