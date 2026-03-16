const express = require("express");
const router = express.Router();
const podAmenityController = require("../controllers/podAmenityController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router
  .route("/")
  .get(podAmenityController.getAllAmenities)
  .post(protect, authorize("admin", "manager"), podAmenityController.createAmenity);

router
  .route("/:id")
  .get(podAmenityController.getAmenityById)
  .put(protect, authorize("admin", "manager"), podAmenityController.updateAmenity)
  .delete(protect, authorize("admin", "manager"), podAmenityController.deleteAmenity);

module.exports = router;
