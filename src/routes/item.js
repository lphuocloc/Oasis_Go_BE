const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
  deleteItem,
} = require("../controllers/itemController");

// GET all items — public
router.get("/", getAllItems);

// GET single item — public
router.get("/:id", getItemById);

// POST create item — admin/manager
router.post("/", protect, authorize("admin", "manager"), createItem);

// PUT update item — admin/manager
router.put("/:id", protect, authorize("admin", "manager"), updateItem);

// DELETE item — admin only
router.delete("/:id", protect, authorize("admin"), deleteItem);

module.exports = router;
