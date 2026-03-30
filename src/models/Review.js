const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const reviewSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    booking_id: {
      type: String,
      required: [true, "Booking ID is required"],
      ref: "Booking",
      unique: true, // One review per booking
      index: true,
    },
    user_id: {
      type: String,
      required: [true, "User ID is required"],
      ref: "User",
      index: true,
    },
    cluster_id: {
      type: String,
      required: [true, "Cluster ID is required"],
      ref: "PodCluster",
      index: true,
    },
    rating: {
      type: Number,
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating must be at most 5"],
      default: null,
    },
    comment: {
      type: String,
      maxlength: [500, "Comment cannot exceed 500 characters"],
      default: null,
      trim: true,
    },
    is_rejected: {
      type: Boolean,
      default: false,
      index: true,
    },
    moderated_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
reviewSchema.index({ user_id: 1, created_at: -1 });
reviewSchema.index({ cluster_id: 1, is_rejected: 1, created_at: -1 });
reviewSchema.index({ booking_id: 1 });

// Virtual for booking details
reviewSchema.virtual("booking", {
  ref: "Booking",
  localField: "booking_id",
  foreignField: "id",
  justOne: true,
});

// Virtual for user details
reviewSchema.virtual("user", {
  ref: "User",
  localField: "user_id",
  foreignField: "_id",
  justOne: true,
});

// Virtual for cluster details
reviewSchema.virtual("cluster", {
  ref: "PodCluster",
  localField: "cluster_id",
  foreignField: "id",
  justOne: true,
});

// Pre-save validation
reviewSchema.pre("save", async function () {
  // If rating and comment are being submitted, moderated_at should remain null until admin reviews
  if (this.rating && !this.is_rejected) {
    this.moderated_at = null;
  }
});

// Instance method to reject review
reviewSchema.methods.reject = async function () {
  this.is_rejected = true;
  this.moderated_at = new Date();
  await this.save();
  return this;
};

// Static method to get reviews by cluster
reviewSchema.statics.getByCluster = async function (clusterId, options = {}) {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = { cluster_id: clusterId, is_rejected: false };

  const [reviews, total] = await Promise.all([
    this.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name avatar")
      .lean(),
    this.countDocuments(filter),
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
};

// Static method to get reviews by user
reviewSchema.statics.getByUser = async function (userId, options = {}) {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const skip = (page - 1) * limit;

  // Only show submitted reviews (rating != null), not pending/placeholder records
  const filter = { user_id: userId, is_rejected: false, rating: { $ne: null } };

  const [reviews, total] = await Promise.all([
    this.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate("cluster", "name")
      .lean(),
    this.countDocuments(filter),
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
};

// Static method to get cluster rating stats
reviewSchema.statics.getClusterStats = async function (clusterId) {
  const stats = await this.aggregate([
    {
      $match: {
        cluster_id: clusterId,
        is_rejected: false,
        rating: { $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: "$rating",
        },
      },
    },
    {
      $project: {
        _id: 0,
        avgRating: { $round: ["$avgRating", 2] },
        totalReviews: 1,
        ratingCounts: {
          $reduce: {
            input: "$ratingDistribution",
            initialValue: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            in: {
              "1": {
                $cond: [{ $eq: ["$$this", 1] }, { $add: ["$$value.1", 1] }, "$$value.1"],
              },
              "2": {
                $cond: [{ $eq: ["$$this", 2] }, { $add: ["$$value.2", 1] }, "$$value.2"],
              },
              "3": {
                $cond: [{ $eq: ["$$this", 3] }, { $add: ["$$value.3", 1] }, "$$value.3"],
              },
              "4": {
                $cond: [{ $eq: ["$$this", 4] }, { $add: ["$$value.4", 1] }, "$$value.4"],
              },
              "5": {
                $cond: [{ $eq: ["$$this", 5] }, { $add: ["$$value.5", 1] }, "$$value.5"],
              },
            },
          },
        },
      },
    },
  ]);

  return stats[0] || { avgRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
};

module.exports = mongoose.model("Review", reviewSchema);
