const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createInventoryStock,
  getAllInventoryStocks,
  getInventoryStockById,
  updateInventoryStock,
  deleteInventoryStock,
} = require("../controllers/inventoryStockController");

router.get("/", getAllInventoryStocks);
router.get("/:id", getInventoryStockById);
router.post("/", protect, authorize("admin", "manager"), createInventoryStock);
router.put("/:id", protect, authorize("admin", "manager"), updateInventoryStock);
router.delete("/:id", protect, authorize("admin"), deleteInventoryStock);

module.exports = router;
