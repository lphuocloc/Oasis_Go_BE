const cleaningMediaService = require("../services/cleaningMediaService");

const resolveUploadedFile = (req) => {
  if (req.file) return req.file;

  if (req.files && typeof req.files === "object") {
    const mediaFile = Array.isArray(req.files.media) ? req.files.media[0] : null;
    if (mediaFile) return mediaFile;

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
      media_url: req.body.media_url || req.body.photo_url,
      media_public_id: uploadedFile && uploadedFile.filename ? uploadedFile.filename : (req.body.media_public_id || req.body.photo_public_id),
      media_buffer: uploadedFile && uploadedFile.buffer ? uploadedFile.buffer : undefined,
      media_mime_type: uploadedFile && uploadedFile.mimetype ? uploadedFile.mimetype : undefined,
      media_type: req.body.media_type || req.body.type,
      file_type: uploadedFile
        ? (String(uploadedFile.mimetype || "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE")
        : req.body.file_type || undefined,
    };

    const media = await cleaningMediaService.createCleaningMedia(payload);
    res.status(201).json({ success: true, message: "Cleaning media created successfully", data: media });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating cleaning media",
      error_code: error.errorCode || "CLEANING_MEDIA_CREATE_FAILED",
      provider_error: error.providerMessage || undefined,
    });
  }
};

exports.getAllCleaningPhotos = async (req, res) => {
  try {
    const query = {
      ...req.query,
      media_type: req.query.media_type || req.query.type,
    };
    const mediaList = await cleaningMediaService.getAllCleaningMedia(query);
    res.status(200).json({ success: true, count: mediaList.length, data: mediaList });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning media" });
  }
};

exports.getCleaningPhotoById = async (req, res) => {
  try {
    const media = await cleaningMediaService.getCleaningMediaById(req.params.id);
    res.status(200).json({ success: true, data: media });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching cleaning media" });
  }
};

exports.updateCleaningPhoto = async (req, res) => {
  try {
    const uploadedFile = resolveUploadedFile(req);
    const payload = {
      ...req.body,
      media_url: req.body.media_url || req.body.photo_url,
      media_public_id: uploadedFile && uploadedFile.filename ? uploadedFile.filename : (req.body.media_public_id || req.body.photo_public_id),
      media_buffer: uploadedFile && uploadedFile.buffer ? uploadedFile.buffer : undefined,
      media_mime_type: uploadedFile && uploadedFile.mimetype ? uploadedFile.mimetype : undefined,
      media_type: req.body.media_type || req.body.type,
      file_type: uploadedFile
        ? (String(uploadedFile.mimetype || "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE")
        : req.body.file_type || undefined,
    };

    const media = await cleaningMediaService.updateCleaningMedia(req.params.id, payload);
    res.status(200).json({ success: true, message: "Cleaning media updated successfully", data: media });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating cleaning media",
      error_code: error.errorCode || "CLEANING_MEDIA_UPDATE_FAILED",
      provider_error: error.providerMessage || undefined,
    });
  }
};

exports.deleteCleaningPhoto = async (req, res) => {
  try {
    const result = await cleaningMediaService.deleteCleaningMedia(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting cleaning media" });
  }
};
