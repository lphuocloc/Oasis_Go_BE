const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deleteWarehouse,
} = require("../controllers/warehouseController");

router.get("/", getAllWarehouses);
router.get("/:id", getWarehouseById);
router.post("/", protect, authorize("admin", "manager"), createWarehouse);
router.put("/:id", protect, authorize("admin", "manager"), updateWarehouse);
router.delete("/:id", protect, authorize("admin"), deleteWarehouse);

module.exports = router;
