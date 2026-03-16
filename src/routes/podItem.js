const express = require("express");
const router = express.Router();
const podItemController = require("../controllers/podItemController");
const { protect, authorize } = require("../middlewares/authMiddleware");

router
  .route("/")
  .get(podItemController.getAllPodItems)
  .post(protect, authorize("admin", "manager"), podItemController.createPodItem);

router
  .route("/:id")
  .get(podItemController.getPodItemById)
  .put(protect, authorize("admin", "manager"), podItemController.updatePodItem)
  .delete(protect, authorize("admin", "manager"), podItemController.deletePodItem);

module.exports = router;
