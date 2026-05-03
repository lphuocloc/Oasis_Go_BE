const Review = require("../models/Review");
const Booking = require("../models/Bookings");
const Pod = require("../models/Pod");

class ReviewService {
  /**
   * Create a review record automatically after booking is completed
   * Called during checkout process (manual or auto)
   * Note: Do NOT create review if booking is NO_SHOW
   */
  async createReviewIfNotExists(booking) {
    try {
      // Skip review creation for NO_SHOW bookings
      if (booking.checkin_state === "NO_SHOW") {
        console.log(`Skipping review creation for NO_SHOW booking ${booking.id}`);
        return null;
      }

      // Check if review already exists
      const existingReview = await Review.findOne({ booking_id: booking.id });
      if (existingReview) {
        return existingReview;
      }

      // Get pod info to get cluster_id
      const pod = await Pod.findOne({ id: booking.pod_id }).select("cluster_id");
      if (!pod) {
        console.error(`Pod not found for booking ${booking.id}`);
        return null;
      }

      // Create empty review record
      const review = new Review({
        booking_id: booking.id,
        user_id: booking.user_id,
        cluster_id: pod.cluster_id,
        rating: null,
        comment: null,
        is_rejected: false,
      });

      await review.save();
      return review;
    } catch (error) {
      // If unique constraint violation, review already exists
      if (error.code === 11000) {
        return await Review.findOne({ booking_id: booking.id });
      }
      console.error(`Error creating review for booking ${booking.id}:`, error);
      throw error;
    }
  }

  /**
   * Get review by booking ID
   */
  async getReviewByBookingId(bookingId) {
    const review = await Review.findOne({ booking_id: bookingId });
    if (!review) {
      const error = new Error("Review not found");
      error.statusCode = 404;
      throw error;
    }
    return review;
  }

  /**
   * Submit review (user fills in rating and comment)
   */
  async submitReview(bookingId, userId, { rating, comment }) {
    // Validate inputs
    if (!rating || rating < 1 || rating > 5) {
      const error = new Error("Rating must be between 1 and 5");
      error.statusCode = 400;
      throw error;
    }

    if (comment && comment.length > 500) {
      const error = new Error("Comment cannot exceed 500 characters");
      error.statusCode = 400;
      throw error;
    }

    // Get booking and verify ownership
    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) {
      const error = new Error("Booking not found");
      error.statusCode = 404;
      throw error;
    }

    if (booking.user_id !== userId) {
      const error = new Error("You can only review your own bookings");
      error.statusCode = 403;
      throw error;
    }

    if (booking.status !== "COMPLETED") {
      const error = new Error("Booking must be completed before review");
      error.statusCode = 400;
      throw error;
    }

    // Check if booking is NO_SHOW - cannot review NO_SHOW bookings
    if (booking.checkin_state === "NO_SHOW") {
      const error = new Error("Cannot review bookings marked as NO_SHOW (no check-in)");
      error.statusCode = 403;
      throw error;
    }

    // Check if booking was cancelled before being used (BOOKED -> CANCELLED)
    // Only allow review if booking was actually used (checkin_state = MANUAL_CHECKED_IN or AUTO_ACTIVATED)
    if (!["MANUAL_CHECKED_IN", "AUTO_ACTIVATED"].includes(booking.checkin_state)) {
      const error = new Error("Can only review bookings that were actually used (not cancelled before check-in)");
      error.statusCode = 403;
      throw error;
    }

    // Get or create review
    let review = await Review.findOne({ booking_id: bookingId });
    if (!review) {
      // Auto create if missing
      review = await this.createReviewIfNotExists(booking);
    }

    // Update review
    review.rating = rating;
    review.comment = comment?.trim() || null;
    await review.save();

    return review;
  }

  /**
   * Get review by ID
   */
  async getReviewById(reviewId) {
    const review = await Review.findOne({ id: reviewId });
    if (!review) {
      const error = new Error("Review not found");
      error.statusCode = 404;
      throw error;
    }
    return review;
  }

  /**
   * Reject review (admin/manager action)
   */
  async rejectReview(reviewId) {
    const review = await Review.findOne({ id: reviewId });
    if (!review) {
      const error = new Error("Review not found");
      error.statusCode = 404;
      throw error;
    }

    await review.reject();
    return review;
  }

  /**
   * Restore (un-hide) a review
   */
  async restoreReview(reviewId) {
    const review = await Review.findOne({ id: reviewId });
    if (!review) {
      const error = new Error("Review not found");
      error.statusCode = 404;
      throw error;
    }

    review.is_rejected = false;
    review.moderated_at = null;
    await review.save();
    return review;
  }

  /**
   * Get reviews by cluster (paginated)
   */
  async getReviewsByCluster(clusterId, { page = 1, limit = 10 } = {}) {
    return await Review.getByCluster(clusterId, { page, limit });
  }

  /**
   * Get reviews by user (paginated)
   */
  async getReviewsByUser(userId, { page = 1, limit = 10 } = {}) {
    return await Review.getByUser(userId, { page, limit });
  }

  /**
   * Get cluster rating statistics
   */
  async getClusterStats(clusterId) {
    return await Review.getClusterStats(clusterId);
  }

  /**
   * Get all reviews for admin moderation (submitted reviews)
   */
  async getAdminAllReviews({ page = 1, limit = 10, status = "active" } = {}) {
    const skip = (page - 1) * limit;

    let filter = {};
    if (status === "hidden") {
      filter = { is_rejected: { $in: [true, "true"] } };
    } else {
      // Active: submitted (rating != null) and not rejected
      filter = { 
        is_rejected: { $nin: [true, "true"] }, 
        rating: { $ne: null } 
      };
    }

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name avatar")
        .populate("cluster", "name")
        .lean(),
      Review.countDocuments(filter),
    ]);

    return {
      data: reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get global review statistics
   */
  async getGlobalStats() {
    const stats = await Review.aggregate([
      {
        $match: {
          rating: { $ne: null },
          is_rejected: { $nin: [true, "true"] },
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          satisfiedCount: {
            $sum: {
              $cond: [{ $gte: ["$rating", 4] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          avgRating: { $round: ["$avgRating", 1] },
          totalReviews: 1,
          satisfactionRate: {
            $cond: [
              { $gt: ["$totalReviews", 0] },
              {
                $multiply: [
                  { $divide: ["$satisfiedCount", "$totalReviews"] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
    ]);

    const result = stats[0] || { avgRating: 0, totalReviews: 0, satisfactionRate: 0 };
    result.satisfactionRate = Math.round(result.satisfactionRate);

    // Also get count of hidden reviews
    result.hiddenReviews = await Review.countDocuments({ is_rejected: { $in: [true, "true"] } });

    return result;
  }
}

module.exports = new ReviewService();
