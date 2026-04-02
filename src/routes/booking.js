const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/bookingController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
	loadManagerScope,
	applyManagerBookingScope,
	requireManagerPodAccess,
} = require("../middlewares/managerScopeMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Booking:
 *       type: object
 *       required:
 *         - order_id
 *         - user_id
 *         - pod_id
 *         - start_time
 *         - end_time
 *         - base_price
 *         - total_price
 *       properties:
 *         id:
 *           type: string
 *           description: Unique booking ID (UUID)
 *         order_id:
 *           type: string
 *           description: Order ID reference
 *         user_id:
 *           type: string
 *           description: User ID reference
 *         pod_id:
 *           type: string
 *           description: Pod ID reference
 *         start_time:
 *           type: string
 *           format: date-time
 *           description: Booking start time
 *         end_time:
 *           type: string
 *           format: date-time
 *           description: Booking end time
 *         actual_end_time:
 *           type: string
 *           format: date-time
 *           description: Actual end time (when completed)
 *         cleaner_access_allowed:
 *           type: boolean
 *           description: Whether cleaner access has been enabled by user
 *         cleaner_access_updated_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         checkin_state:
 *           type: string
 *           enum: [PENDING, MANUAL_CHECKED_IN, AUTO_ACTIVATED, NO_SHOW]
 *           description: Check-in tracking state
 *         checked_in_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         checkin_source:
 *           type: string
 *           enum: [USER_QR, SYSTEM_AUTO]
 *           nullable: true
 *         auto_activated_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         no_show_marked_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [BOOKED, IN_USE, COMPLETED, CANCELLED]
 *           description: Booking status
 *         base_price:
 *           type: number
 *           description: Base price for this booking
 *         total_price:
 *           type: number
 *           description: Total price including any fees
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/bookings:
 *   get:
 *     summary: Get all bookings with filters
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: pod_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: order_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [BOOKED, IN_USE, COMPLETED, CANCELLED]
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Bookings retrieved successfully
 */
router.get(
	"/",
	protect,
	authorize("admin", "manager"),
	loadManagerScope,
	applyManagerBookingScope,
	bookingController.getAllBookings
);

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     summary: Create a new booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - order_id
 *               - user_id
 *               - pod_id
 *               - start_time
 *               - end_time
 *               - base_price
 *               - total_price
 *             properties:
 *               order_id:
 *                 type: string
 *               user_id:
 *                 type: string
 *               pod_id:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               base_price:
 *                 type: number
 *               total_price:
 *                 type: number
 *     responses:
 *       201:
 *         description: Booking created successfully
 */
router.post("/", protect, bookingController.createBooking);

/**
 * @swagger
 * /api/bookings/checkin:
 *   post:
 *     summary: Checkin booking (customer uses qr_token, cleaner uses key_token)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Provide either qr_token (customer flow) or key_token (cleaner flow)
 *             properties:
 *               qr_token:
 *                 type: string
 *                 description: Required for customer check-in
 *               key_token:
 *                 type: string
 *                 description: Required for cleaner check-in
 *     responses:
 *       200:
 *         description: Checkin successful
 *       400:
 *         description: Invalid request body or booking status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: QR expired, wrong key owner, or checkin not allowed
 *       404:
 *         description: QR/key or booking not found
 */
router.post("/checkin", protect, bookingController.checkinWithQrAndKey);

/**
 * @swagger
 * /api/bookings/check-availability/{podId}:
 *   get:
 *     summary: Check pod availability for time range
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: podId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: start_time
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_time
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Availability checked
 */
router.get("/check-availability/:podId", bookingController.checkAvailability);

/**
 * @swagger
 * /api/bookings/user/{userId}:
 *   get:
 *     summary: Get bookings by user
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [BOOKED, IN_USE, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: User bookings retrieved
 */
router.get("/user/:userId", protect, bookingController.getBookingsByUser);

/**
 * @swagger
 * /api/bookings/pod/{podId}:
 *   get:
 *     summary: Get bookings by pod
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: podId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [BOOKED, IN_USE, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Pod bookings retrieved
 */
router.get(
	"/pod/:podId",
	protect,
	authorize("admin", "manager"),
	loadManagerScope,
	requireManagerPodAccess({ source: "params", key: "podId" }),
	bookingController.getBookingsByPod
);

/**
 * @swagger
 * /api/bookings/order/{orderId}:
 *   get:
 *     summary: Get bookings by order
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order bookings retrieved
 */
router.get("/order/:orderId", protect, bookingController.getBookingsByOrder);

/**
 * @swagger
 * /api/bookings/{id}/my-cleaner-key:
 *   get:
 *     summary: Get my cleaner online key for a booking
 *     tags: [Bookings]
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
 *         description: Cleaner key retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Only cleaner can access this endpoint
 *       404:
 *         description: Booking or cleaner key not found
 */
router.get("/:id/my-cleaner-key", protect, bookingController.getMyCleanerKeyByBookingId);

/**
 * @swagger
 * /api/bookings/{id}:
 *   get:
 *     summary: Get booking by ID
 *     tags: [Bookings]
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
 *         description: Booking retrieved
 *       404:
 *         description: Booking not found
 */
router.get("/:id", protect, bookingController.getBookingById);

/**
 * @swagger
 * /api/bookings/{id}:
 *   put:
 *     summary: Update booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               base_price:
 *                 type: number
 *               total_price:
 *                 type: number
 *     responses:
 *       200:
 *         description: Booking updated
 */
router.put("/:id", protect, bookingController.updateBooking);

/**
 * @swagger
 * /api/bookings/{id}/change-pod:
 *   patch:
 *     summary: Manager change pod for a booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pod_id
 *             properties:
 *               pod_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking pod changed
 */
router.patch(
	"/:id/change-pod",
	protect,
	authorize("manager"),
	loadManagerScope,
	requireManagerPodAccess({ source: "body", key: "pod_id" }),
	bookingController.managerChangePod
);

/**
 * @swagger
 * /api/bookings/{id}/cleaner-access:
 *   post:
 *     summary: Enable or disable cleaner access confirmation for booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - allowed
 *             properties:
 *               allowed:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Cleaner access flag updated
 */
router.post("/:id/cleaner-access", protect, bookingController.setCleanerAccessFlag);

/**
 * @swagger
 * /api/bookings/{id}/cancel:
 *   post:
 *     summary: Cancel booking
 *     tags: [Bookings]
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
 *         description: Booking cancelled
 */
router.post("/:id/cancel", protect, bookingController.cancelBooking);


module.exports = router;
