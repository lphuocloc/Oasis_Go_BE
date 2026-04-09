const cleaningPhotoService = require("../services/cleaningPhotoService");

const resolveUploadedFile = (req) => {
  if (req.file) return req.file;

  if (req.files && typeof req.files === "object") {
    const photoFile = Array.isArray(req.files.photo) ? req.files.photo[0] : null;
    if (photoFile) return photoFile;

    const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : null;
    if (imageFile) return imageFile;
  }

  return null;
};

exports.createCleaningPhoto = async (req, res) => {
  try {
    const uploadedFile = resolveUploadedFile(req);
    const payload = {
      ...req.body,
      photo_url: req.body.photo_url,
      photo_public_id: uploadedFile && uploadedFile.filename ? uploadedFile.filename : req.body.photo_public_id,
      photo_buffer: uploadedFile && uploadedFile.buffer ? uploadedFile.buffer : undefined,
      photo_mime_type: uploadedFile && uploadedFile.mimetype ? uploadedFile.mimetype : undefined,
    };

    const photo = await cleaningPhotoService.createCleaningPhoto(payload);
    res.status(201).json({ success: true, message: "Cleaning photo created successfully", data: photo });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating cleaning photo",
      error_code: error.errorCode || "CLEANING_PHOTO_CREATE_FAILED",
      provider_error: error.providerMessage || undefined,
    });
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
    const uploadedFile = resolveUploadedFile(req);
    const payload = {
      ...req.body,
      photo_url: req.body.photo_url,
      photo_public_id: uploadedFile && uploadedFile.filename ? uploadedFile.filename : req.body.photo_public_id,
      photo_buffer: uploadedFile && uploadedFile.buffer ? uploadedFile.buffer : undefined,
      photo_mime_type: uploadedFile && uploadedFile.mimetype ? uploadedFile.mimetype : undefined,
    };

    const photo = await cleaningPhotoService.updateCleaningPhoto(req.params.id, payload);
    res.status(200).json({ success: true, message: "Cleaning photo updated successfully", data: photo });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating cleaning photo",
      error_code: error.errorCode || "CLEANING_PHOTO_UPDATE_FAILED",
      provider_error: error.providerMessage || undefined,
    });
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
