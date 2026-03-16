const express = require("express");
const router = express.Router();
const doorController = require("../controllers/doorController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router
  .route("/")
  .get(doorController.getAllDoors)
  .post(protect, authorize("admin", "manager"), doorController.createDoor);

router
  .route("/:id")
  .get(doorController.getDoorById)
  .put(protect, authorize("admin", "manager"), doorController.updateDoor)
  .delete(protect, authorize("admin"), doorController.deleteDoor);

module.exports = router;
