const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryCheckoutLog,
  getAllInventoryCheckoutLogs,
  getInventoryCheckoutLogById,
  updateInventoryCheckoutLog,
  deleteInventoryCheckoutLog,
} = require("../controllers/inventoryCheckoutLogController");

router.get("/", getAllInventoryCheckoutLogs);
router.get("/:id", getInventoryCheckoutLogById);
router.post("/", protect, authorize("admin", "manager"), createInventoryCheckoutLog);
router.put("/:id", protect, authorize("admin", "manager"), updateInventoryCheckoutLog);
router.delete("/:id", protect, authorize("admin"), deleteInventoryCheckoutLog);

module.exports = router;
