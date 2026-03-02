const mongoose = require("mongoose");
const Booking = require("../models/Bookings");
const Pod = require("../models/Pod");

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

/**
 * Check overlap time
 */
const isTimeOverlap = (startA, endA, startB, endB) => {
  return startA < endB && startB < endA;
};

//////////////////////////////
// READ
//////////////////////////////

/**
 * Get bookings (generic)
 * dùng cho staff dashboard, admin
 */
exports.getBookings = async (filters = {}) => {
  const query = {};

  if (filters.locationId) {
    query.location = filters.locationId;
  }

  if (filters.podId) {
    query.pod = filters.podId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.from && filters.to) {
    query.startTime = {
      $gte: filters.from,
      $lte: filters.to
    };
  }

  return Booking.find(query)
    .populate("pod", "code name")
    .populate("user", "name email")
    .sort({ startTime: -1 });
};

/**
 * Get booking detail
 */
exports.getBookingById = async (bookingId) => {
  if (!isValidObjectId(bookingId)) {
    throw new Error("Invalid bookingId");
  }

  const booking = await Booking.findById(bookingId)
    .populate("pod")
    .populate("user");

  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
};

//////////////////////////////
// WRITE
//////////////////////////////

/**
 * Create booking
 * dùng cho customer
 */
exports.createBooking = async ({
  userId,
  podId,
  startTime,
  endTime
}) => {
  if (
    !isValidObjectId(userId) ||
    !isValidObjectId(podId)
  ) {
    throw new Error("Invalid input");
  }

  const pod = await Pod.findById(podId);
  if (!pod) {
    throw new Error("Pod not found");
  }

  if (pod.status !== "AVAILABLE") {
    throw new Error("Pod is not available");
  }

  // Check overlap
  const existingBookings = await Booking.find({
    pod: podId,
    status: { $in: ["BOOKED", "IN_USE"] }
  });

  for (const booking of existingBookings) {
    if (
      isTimeOverlap(
        startTime,
        endTime,
        booking.startTime,
        booking.endTime
      )
    ) {
      throw new Error("Time slot is not available");
    }
  }

  const booking = await Booking.create({
    user: userId,
    pod: podId,
    location: pod.location,
    startTime,
    endTime,
    status: "BOOKED"
  });

  // Lock pod
  pod.status = "OCCUPIED";
  await pod.save();

  return booking;
};

/**
 * Complete booking
 * dùng cho system / staff
 */
exports.completeBooking = async (bookingId) => {
  const booking = await exports.getBookingById(bookingId);

  booking.status = "COMPLETED";
  booking.actualEndTime = new Date();
  await booking.save();

  await Pod.findByIdAndUpdate(booking.pod, {
    status: "NEEDS_CLEANING"
  });

  return booking;
};

/**
 * Cancel booking
 */
exports.cancelBooking = async (bookingId) => {
  const booking = await exports.getBookingById(bookingId);

  if (booking.status === "COMPLETED") {
    throw new Error("Cannot cancel completed booking");
  }

  booking.status = "CANCELLED";
  await booking.save();

  await Pod.findByIdAndUpdate(booking.pod, {
    status: "AVAILABLE"
  });

  return booking;
};