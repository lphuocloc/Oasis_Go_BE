const express = require("express");
const router = express.Router();
const shiftHandoverController = require("../controllers/shiftHandoverController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope } = require("../middlewares/managerScopeMiddleware");

router.post(
  "/",
  protect,
  authorize("manager"),
  shiftHandoverController.createHandover
);

router.get(
  "/recent",
  protect,
  loadManagerScope,
  shiftHandoverController.getRecentHandovers
);

module.exports = router;
