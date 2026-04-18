const podItemService = require("../services/podItemService");

exports.createPodItem = async (req, res) => {
  try {
    const podItem = await podItemService.createPodItem(req.body);
    res.status(201).json({ success: true, message: "Pod item created successfully", data: podItem });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error creating pod item" });
  }
};

exports.createPodItemsForCluster = async (req, res) => {
  try {
    const result = await podItemService.createPodItemsForCluster(req.body);
    res.status(201).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error assigning pod items for cluster",
    });
  }
};

exports.getAllPodItems = async (req, res) => {
  try {
    const podItems = await podItemService.getAllPodItems(req.query);
    res.status(200).json({ success: true, count: podItems.length, data: podItems });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching pod items", error: error.message });
  }
};

exports.getPodItemById = async (req, res) => {
  try {
    const podItem = await podItemService.getPodItemById(req.params.id);
    res.status(200).json({ success: true, data: podItem });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error fetching pod item" });
  }
};

exports.updatePodItem = async (req, res) => {
  try {
    const podItem = await podItemService.updatePodItem(req.params.id, req.body);
    res.status(200).json({ success: true, message: "Pod item updated successfully", data: podItem });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error updating pod item" });
  }
};

exports.deletePodItem = async (req, res) => {
  try {
    const result = await podItemService.deletePodItem(req.params.id);
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ success: false, message: error.message || "Error deleting pod item" });
  }
};
