const express = require("express");
const router = express.Router();
const bookingSlotController = require("../controllers/bookingSlotController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Get all booking slots with filters
router.get("/", protect, authorize("admin", "manager"), bookingSlotController.getAllBookingSlots);

// Create a new booking slot
router.post("/", protect, bookingSlotController.createBookingSlot);

// Get all booking slots for a booking
router.get("/booking/:bookingId", protect, bookingSlotController.getSlotsByBooking);

// Get all bookings for a time slot
router.get("/timeslot/:timeSlotId", protect, bookingSlotController.getBookingsByTimeSlot);

// Check if a time slot is booked
router.get("/check/:timeSlotId", bookingSlotController.isSlotBooked);

// Get booking slot by ID
router.get("/:id", protect, bookingSlotController.getBookingSlotById);

// Delete booking slot
router.delete("/:id", protect, bookingSlotController.deleteBookingSlot);

// Delete all booking slots for a booking
router.delete("/booking/:bookingId", protect, bookingSlotController.deleteSlotsByBooking);

module.exports = router;

module.exports = router;
