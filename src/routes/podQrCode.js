const express = require("express");
const router = express.Router();
const podQrCodeController = require("../controllers/podQrCodeController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router
  .route("/")
  .get(podQrCodeController.getAllQrCodes)
  .post(protect, authorize("admin", "manager"), podQrCodeController.createQrCode);

router
  .route("/:id")
  .get(podQrCodeController.getQrCodeById)
  .put(protect, authorize("admin", "manager"), podQrCodeController.updateQrCode)
  .delete(protect, authorize("admin", "manager"), podQrCodeController.deleteQrCode);

module.exports = router;
