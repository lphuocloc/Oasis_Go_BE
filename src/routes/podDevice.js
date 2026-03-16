const express = require("express");
const router = express.Router();
const podDeviceController = require("../controllers/podDeviceController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router
  .route("/")
  .get(podDeviceController.getAllDevices)
  .post(protect, authorize("admin", "manager"), podDeviceController.createDevice);

router
  .route("/:id")
  .get(podDeviceController.getDeviceById)
  .put(protect, authorize("admin", "manager"), podDeviceController.updateDevice)
  .delete(protect, authorize("admin", "manager"), podDeviceController.deleteDevice);

module.exports = router;
