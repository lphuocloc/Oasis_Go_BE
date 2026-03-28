const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const { protect, authorize } = require("../middlewares/authMiddleware");
const { loadManagerScope } = require("../middlewares/managerScopeMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Review:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique review ID (UUID)
 *         booking_id:
 *           type: string
 *           description: Booking ID reference
 *         user_id:
 *           type: string
 *           description: User ID who submitted review
 *         cluster_id:
 *           type: string
 *           description: Pod cluster ID
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           description: Review rating (1-5)
 *         comment:
 *           type: string
 *           maxLength: 500
 *           description: Review comment
 *         is_rejected:
 *           type: boolean
 *           description: Whether review was rejected by moderator
 *         moderated_at:
 *           type: string
 *           format: date-time
 *           description: When moderator acted on review
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/reviews/{booking_id}:
 *   get:
 *     summary: Get review for a booking
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Review'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Review not found
 */
router.get("/:booking_id", protect, reviewController.getReviewByBookingId);

/**
 * @swagger
 * /api/reviews/{booking_id}:
 *   put:
 *     summary: Submit or update review for a booking
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: booking_id
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
 *               - rating
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 5
 *               comment:
 *                 type: string
 *                 maxLength: 500
 *                 example: "Great pod! Clean and quiet."
 *     responses:
 *       200:
 *         description: Review submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Review'
 *       400:
 *         description: Invalid rating or comment
 *       403:
 *         description: Not booking owner
 *       404:
 *         description: Booking not found or not completed
 */
router.put("/:booking_id", protect, reviewController.submitReview);

/**
 * @swagger
 * /api/reviews/cluster/{cluster_id}:
 *   get:
 *     summary: Get reviews for a cluster (public list)
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: cluster_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of cluster reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Review'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get("/cluster/:cluster_id", reviewController.getReviewsByCluster);

/**
 * @swagger
 * /api/reviews/cluster/{cluster_id}/stats:
 *   get:
 *     summary: Get cluster rating statistics
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: cluster_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cluster statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     avgRating:
 *                       type: number
 *                       format: float
 *                     totalReviews:
 *                       type: integer
 *                     ratingCounts:
 *                       type: object
 *                       properties:
 *                         "1":
 *                           type: integer
 *                         "2":
 *                           type: integer
 *                         "3":
 *                           type: integer
 *                         "4":
 *                           type: integer
 *                         "5":
 *                           type: integer
 */
router.get("/cluster/:cluster_id/stats", reviewController.getClusterStats);

/**
 * @swagger
 * /api/reviews/user/{user_id}:
 *   get:
 *     summary: Get reviews submitted by a user
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of user reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Review'
 *                 pagination:
 *                   type: object
 */
router.get("/user/:user_id", reviewController.getReviewsByUser);

/**
 * @swagger
 * /api/reviews/{review_id}/reject:
 *   post:
 *     summary: Reject a review (admin/manager only)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: review_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review rejected successfully
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Review not found
 */
router.post(
  "/:review_id/reject",
  protect,
  authorize("admin", "manager"),
  reviewController.rejectReview
);

/**
 * @swagger
 * /api/reviews/admin/pending:
 *   get:
 *     summary: Get pending reviews not yet submitted (admin only)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of pending reviews
 */
router.get(
  "/admin/pending",
  protect,
  authorize("admin", "manager"),
  reviewController.getPendingReviews
);

/**
 * @swagger
 * /api/reviews/admin/rejected:
 *   get:
 *     summary: Get rejected reviews (admin only)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of rejected reviews
 */
router.get(
  "/admin/rejected",
  protect,
  authorize("admin", "manager"),
  reviewController.getRejectedReviews
);

module.exports = router;
