const reviewService = require("../services/reviewService");
const Booking = require("../models/Bookings");

class ReviewController {
  /**
   * Get review by booking ID
   * GET /api/reviews/:booking_id
   */
  async getReviewByBookingId(req, res, next) {
    try {
      const { booking_id } = req.params;

      // Verify booking exists and belongs to user
      const booking = await Booking.findOne({ id: booking_id });
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (booking.user_id !== req.user._id.toString() && booking.user_id !== req.user.id) {
        return res.status(403).json({ message: "You can only access your own reviews" });
      }

      const review = await reviewService.getReviewByBookingId(booking_id);

      return res.status(200).json({
        success: true,
        data: review,
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      next(error);
    }
  }

  /**
   * Submit review for a booking
   * PUT /api/reviews/:booking_id
   * Body: { rating: 1-5, comment: "optional text" }
   */
  async submitReview(req, res, next) {
    try {
      const { booking_id } = req.params;
      const { rating, comment } = req.body;
      const userId = req.user._id.toString();

      // Validate required fields
      if (rating === undefined) {
        return res.status(400).json({ message: "Rating is required" });
      }

      const review = await reviewService.submitReview(booking_id, userId, {
        rating,
        comment,
      });

      return res.status(200).json({
        success: true,
        message: "Review thành công!",
        data: review,
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message });
      }
      if (error.statusCode === 403) {
        return res.status(403).json({ message: error.message });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      next(error);
    }
  }

  /**
   * Get reviews by cluster
   * GET /api/reviews/cluster/:cluster_id
   * Query params: page, limit
   */
  async getReviewsByCluster(req, res, next) {
    try {
      const { cluster_id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await reviewService.getReviewsByCluster(cluster_id, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get reviews by user
   * GET /api/reviews/user/:user_id
   * Query params: page, limit
   */
  async getReviewsByUser(req, res, next) {
    try {
      const { user_id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await reviewService.getReviewsByUser(user_id, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cluster rating statistics
   * GET /api/reviews/cluster/:cluster_id/stats
   */
  async getClusterStats(req, res, next) {
    try {
      const { cluster_id } = req.params;

      const stats = await reviewService.getClusterStats(cluster_id);

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reject a review (Admin/Manager only)
   * POST /api/reviews/:review_id/reject
   */
  async rejectReview(req, res, next) {
    try {
      const { review_id } = req.params;

      const review = await reviewService.rejectReview(review_id);

      return res.status(200).json({
        success: true,
        message: "Đã ẩn đánh giá!",
        data: review,
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      next(error);
    }
  }

  /**
   * Restore a hidden review (Admin/Manager only)
   * POST /api/reviews/:review_id/restore
   */
  async restoreReview(req, res, next) {
    try {
      const { review_id } = req.params;

      const review = await reviewService.restoreReview(review_id);

      return res.status(200).json({
        success: true,
        message: "Đã hiển thị lại đánh giá!",
        data: review,
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      next(error);
    }
  }

  /**
   * Get all reviews for admin moderation
   * GET /api/reviews/admin/all
   */
  async getAdminAllReviews(req, res, next) {
    try {
      const { page = 1, limit = 10, status = "active" } = req.query;

      const result = await reviewService.getAdminAllReviews({
        page: parseInt(page),
        limit: parseInt(limit),
        status,
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get global review stats
   * GET /api/reviews/stats
   */
  async getGlobalStats(req, res, next) {
    try {
      const stats = await reviewService.getGlobalStats();

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReviewController();
