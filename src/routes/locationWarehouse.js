const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createLocationWarehouse,
  getAllLocationWarehouses,
  getLocationWarehouseById,
  getEffectiveLocationWarehouses,
  getEffectiveLocationWarehousesDebug,
  updateLocationWarehouse,
  deleteLocationWarehouse,
} = require("../controllers/locationWarehouseController");

router.get("/", getAllLocationWarehouses);
router.get("/effective/:locationId", getEffectiveLocationWarehouses);
router.get("/effective/:locationId/debug", getEffectiveLocationWarehousesDebug);
router.get("/:id", getLocationWarehouseById);
router.post("/", protect, authorize("admin", "manager"), createLocationWarehouse);
router.put("/:id", protect, authorize("admin", "manager"), updateLocationWarehouse);
router.delete("/:id", protect, authorize("admin"), deleteLocationWarehouse);

module.exports = router;
