const podAmenityService = require("../services/podAmenityService");

exports.createAmenity = async (req, res) => {
  try {
    const amenity = await podAmenityService.createAmenity(req.body);
    res.status(201).json({ success: true, message: "Pod amenity created successfully", data: amenity });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating pod amenity" });
  }
};

exports.getAllAmenities = async (req, res) => {
  try {
    const amenities = await podAmenityService.getAllAmenities(req.query);
    res.status(200).json({ success: true, count: amenities.length, data: amenities });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching pod amenities", error: error.message });
  }
};

exports.getAmenityById = async (req, res) => {
  try {
    const amenity = await podAmenityService.getAmenityById(req.params.id);
    res.status(200).json({ success: true, data: amenity });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching pod amenity" });
  }
};

exports.updateAmenity = async (req, res) => {
  try {
    const amenity = await podAmenityService.updateAmenity(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Pod amenity updated successfully", data: amenity });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating pod amenity" });
  }
};

exports.deleteAmenity = async (req, res) => {
  try {
    const result = await podAmenityService.deleteAmenity(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting pod amenity" });
  }
};
