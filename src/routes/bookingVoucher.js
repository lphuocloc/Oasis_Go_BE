const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const bookingVoucherController = require("../controllers/bookingVoucherController");

/**
 * @swagger
 * tags:
 *   name: Booking Vouchers
 *   description: Booking-voucher linkage management (phase 1)
 */

/**
 * @swagger
 * /api/booking-vouchers:
 *   post:
 *     summary: Create booking voucher record
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 *   get:
 *     summary: Get booking voucher records
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 */
router.post("/", protect, authorize("admin"), bookingVoucherController.createBookingVoucher);
router.get("/", protect, authorize("admin"), bookingVoucherController.getBookingVouchers);

/**
 * @swagger
 * /api/booking-vouchers/{id}:
 *   get:
 *     summary: Get booking voucher record by id
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete booking voucher record by id
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id", protect, authorize("admin"), bookingVoucherController.getBookingVoucherById);
router.delete("/:id", protect, authorize("admin"), bookingVoucherController.deleteBookingVoucher);

module.exports = router;
