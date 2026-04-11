const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middlewares/authMiddleware");
const bookingVoucherController = require("../controllers/bookingVoucherController");

/**
 * @swagger
 * components:
 *   schemas:
 *     BookingVoucher:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: f8f8d3d7-9b6d-4e8d-a4f8-9a29b14f3a6e
 *         order_id:
 *           type: string
 *           example: ORDER_001
 *         voucher_id:
 *           type: string
 *           example: VOUCHER_001
 *         discount_amount:
 *           type: number
 *           example: 50000
 *         applied_at:
 *           type: string
 *           format: date-time
 *           example: 2026-04-07T10:15:00.000Z
 *         _id:
 *           type: string
 *           example: 67f3c73c6f9f14a4a10a0a10
 *
 *     BookingVoucherPagination:
 *       type: object
 *       properties:
 *         current_page:
 *           type: integer
 *           example: 1
 *         total_pages:
 *           type: integer
 *           example: 3
 *         total_items:
 *           type: integer
 *           example: 45
 *         items_per_page:
 *           type: integer
 *           example: 20
 *
 *     BookingVoucherListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/BookingVoucher'
 *         pagination:
 *           $ref: '#/components/schemas/BookingVoucherPagination'
 *
 *     BookingVoucherItemResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           $ref: '#/components/schemas/BookingVoucher'
 *
 *     BookingVoucherErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Failed to get booking voucher records
 *
 *     BookingVoucherDeleteResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Booking voucher record deleted successfully
 *
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
 *     responses:
 *       201:
 *         description: Booking voucher record created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherItemResponse'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherErrorResponse'
 *       409:
 *         description: Order already has a voucher record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherErrorResponse'
 *   get:
 *     summary: Get booking voucher records
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: order_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: voucher_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of booking voucher records
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherListResponse'
 *       500:
 *         description: Failed to get booking voucher records
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherErrorResponse'
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking voucher record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherItemResponse'
 *       404:
 *         description: Booking voucher record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherErrorResponse'
 *   delete:
 *     summary: Delete booking voucher record by id
 *     tags: [Booking Vouchers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking voucher record deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherDeleteResponse'
 *       404:
 *         description: Booking voucher record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BookingVoucherErrorResponse'
 */
router.get("/:id", protect, authorize("admin"), bookingVoucherController.getBookingVoucherById);
router.delete("/:id", protect, authorize("admin"), bookingVoucherController.deleteBookingVoucher);

module.exports = router;
