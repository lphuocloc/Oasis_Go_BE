const mongoose = require("mongoose");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Booking = require("../models/Bookings");
const Incident = require("../models/Incidents");
const User = require("../models/User");
const Location = require("../models/Location");
const Transaction = require("../models/Transaction");

const OPEN_INCIDENT_STATUSES = ["PENDING", "INVESTIGATING"];
const SUCCESS_PAYMENT_STATUSES = ["SUCCESS"];

const toDateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getDefaultTodayRange = () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to };
};

const getDateRange = (fromInput, toInput) => {
  const defaults = getDefaultTodayRange();
  const from = toDateOrNull(fromInput) || defaults.from;
  const to = toDateOrNull(toInput) || defaults.to;
  return { from, to };
};

const buildScopedPodIds = async (locationId, clusterId) => {
  const podFilter = {};

  if (locationId) {
    const clusters = await PodCluster.find({ location_id: locationId }).select("id").lean();
    const clusterIdsFromLocation = clusters.map((c) => c.id);
    podFilter.cluster_id = { $in: clusterIdsFromLocation };
  }

  if (clusterId) {
    if (podFilter.cluster_id && podFilter.cluster_id.$in) {
      podFilter.cluster_id = {
        $in: podFilter.cluster_id.$in.filter((cid) => cid === clusterId),
      };
    } else {
      podFilter.cluster_id = clusterId;
    }
  }

  const pods = await Pod.find(podFilter).select("id code status cluster_id").lean();
  return pods;
};

const countByField = (items, fieldName) => {
  return items.reduce((acc, item) => {
    const key = item[fieldName] || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
};

const buildPieData = (countsObj) => {
  return Object.entries(countsObj).map(([status, count]) => ({ status, count }));
};

const toObjectIdArray = (docs) => docs.map((d) => d._id).filter(Boolean);

const normalizeIsRejected = (value) => {
  if (value === true || value === "true") return "true";
  return "false";
};

exports.getDashboard = async (req, res) => {
  try {
    const { from, to, groupBy = "day" } = req.query;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const rangeFrom = from ? new Date(from) : startOfToday;
    const rangeTo = to ? new Date(to) : endOfToday;

    const podService = require("../services/podService");
    const bookingService = require("../services/bookingService");
    const incidentService = require("../services/incidentService");

    const podFilters = {};
    const bookingFilters = { start_date: rangeFrom, end_date: rangeTo };
    const incidentFilters = {};

    const [pods, bookingsResult, incidents] = await Promise.all([
      podService.getAllPods(podFilters),
      bookingService.getAllBookings(bookingFilters),
      incidentService.getIncidents(incidentFilters),
    ]);

    const bookings = bookingsResult.bookings;

    const summary = {
      podsTotal: pods.length,
      bookingsInRange: bookings.length,
      incidentsTotal: incidents.length,
    };

    return res.status(200).json({
      success: true,
      data: {
        summary,
        pods: { list: pods },
        bookings: { from: rangeFrom, to: rangeTo, list: bookings },
        incidents: { list: incidents },
      },
    });
  } catch (error) {
    console.error("Get dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching dashboard",
    });
  }
};

exports.getAdminStats = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = getDateRange(from, to);

    const [
      totalUsers,
      activeUsers,
      newUsersInPeriod,
      usersByRole,
      totalAllTimeRevenueAgg,
      periodRevenueAgg,
      successfulPayments,
      refundedAmountAgg,
      revenueByMethod,
      revenueByStatus,
      recentPayments,
      allLocations,
      allClusters,
      allPods,
      periodBookings,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: range.from, $lte: range.to } }),
      User.aggregate([
        { $group: { _id: "$role", count: { $sum: 1 } } },
        { $project: { _id: 0, role: "$_id", count: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: { $in: SUCCESS_PAYMENT_STATUSES }, type: "CHARGE" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            created_at: { $gte: range.from, $lte: range.to },
            type: "CHARGE",
            status: { $in: SUCCESS_PAYMENT_STATUSES },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.countDocuments({
        created_at: { $gte: range.from, $lte: range.to },
        type: "CHARGE",
        status: { $in: SUCCESS_PAYMENT_STATUSES },
      }),
      Transaction.aggregate([
        {
          $match: {
            created_at: { $gte: range.from, $lte: range.to },
            type: "REFUND",
            status: { $in: SUCCESS_PAYMENT_STATUSES },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.aggregate([
        { $match: { created_at: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $project: { _id: 0, method: "$_id", amount: 1, count: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { created_at: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", amount: 1, count: 1 } },
      ]),
      Transaction.find({ created_at: { $gte: range.from, $lte: range.to } })
        .sort({ created_at: -1 })
        .limit(10)
        .lean(),
      Location.find({}).select("id name type").lean(),
      PodCluster.find({}).select("id location_id").lean(),
      Pod.find({}).select("id status cluster_id").lean(),
      Booking.find({ start_time: { $gte: range.from, $lte: range.to } })
        .select("id pod_id total_price status")
        .lean(),
    ]);

    const clusterIdsByLocation = new Map();
    allClusters.forEach((cluster) => {
      if (!clusterIdsByLocation.has(cluster.location_id)) {
        clusterIdsByLocation.set(cluster.location_id, []);
      }
      clusterIdsByLocation.get(cluster.location_id).push(cluster.id);
    });

    const podsByCluster = new Map();
    allPods.forEach((pod) => {
      if (!podsByCluster.has(pod.cluster_id)) {
        podsByCluster.set(pod.cluster_id, []);
      }
      podsByCluster.get(pod.cluster_id).push(pod);
    });

    const bookingsByPod = new Map();
    periodBookings.forEach((booking) => {
      if (!bookingsByPod.has(booking.pod_id)) {
        bookingsByPod.set(booking.pod_id, []);
      }
      bookingsByPod.get(booking.pod_id).push(booking);
    });

    const locations = allLocations.map((location) => {
      const clusterIds = clusterIdsByLocation.get(location.id) || [];
      const pods = clusterIds.flatMap((cid) => podsByCluster.get(cid) || []);
      const podIds = pods.map((p) => p.id);
      const bookings = podIds.flatMap((pid) => bookingsByPod.get(pid) || []);

      return {
        id: location.id,
        name: location.name,
        type: location.type,
        totalPods: pods.length,
        activePods: pods.filter((p) => ["AVAILABLE", "OCCUPIED"].includes(p.status)).length,
        totalBookings: bookings.length,
        totalRevenue: bookings
          .filter((b) => b.status !== "CANCELLED")
          .reduce((sum, b) => sum + (b.total_price || 0), 0),
      };
    });

    const db = mongoose.connection && mongoose.connection.db ? mongoose.connection.db : null;

    let reviews = {
      total: 0,
      pendingModeration: 0,
      averageRating: 0,
      ratingDistribution: [],
      latest: [],
    };

    let vouchers = {
      totalActive: 0,
      usedInPeriod: 0,
      totalDiscountGiven: 0,
      topVouchers: [],
    };

    if (db) {
      const reviewsCol = db.collection("reviews");
      const vouchersCol = db.collection("vouchers");
      const bookingVouchersCol = db.collection("booking_vouchers");

      const [
        reviewTotal,
        reviewPending,
        reviewAvgAgg,
        reviewDistAgg,
        latestReviewsRaw,
      ] = await Promise.all([
        reviewsCol.countDocuments({}),
        reviewsCol.countDocuments({ is_rejected: { $in: [true, "true"] } }),
        reviewsCol
          .aggregate([{ $group: { _id: null, avg: { $avg: "$rating" } } }])
          .toArray(),
        reviewsCol
          .aggregate([
            { $group: { _id: "$rating", count: { $sum: 1 } } },
            { $project: { _id: 0, rating: "$_id", count: 1 } },
            { $sort: { rating: 1 } },
          ])
          .toArray(),
        reviewsCol.find({}).sort({ created_at: -1 }).limit(10).toArray(),
      ]);

      const latestReviewUserIds = [...new Set(latestReviewsRaw.map((r) => r.user_id).filter(Boolean))];
      const latestReviewBookingIds = [...new Set(latestReviewsRaw.map((r) => r.booking_id).filter(Boolean))];

      const [reviewUsers, reviewBookings] = await Promise.all([
        User.find({ _id: { $in: latestReviewUserIds } }).select("name").lean(),
        Booking.find({ id: { $in: latestReviewBookingIds } }).select("id pod_id").lean(),
      ]);

      const reviewUserMap = new Map(reviewUsers.map((u) => [String(u._id), u.name || "Unknown"]));
      const reviewBookingMap = new Map(reviewBookings.map((b) => [b.id, b]));
      const reviewPodIds = [...new Set(reviewBookings.map((b) => b.pod_id).filter(Boolean))];
      const reviewPods = await Pod.find({ id: { $in: reviewPodIds } }).select("id code").lean();
      const reviewPodMap = new Map(reviewPods.map((p) => [p.id, p.code || "N/A"]));

      reviews = {
        total: reviewTotal,
        pendingModeration: reviewPending,
        averageRating: reviewAvgAgg[0] ? Number(reviewAvgAgg[0].avg || 0) : 0,
        ratingDistribution: reviewDistAgg,
        latest: latestReviewsRaw.map((r) => {
          const booking = reviewBookingMap.get(r.booking_id);
          return {
            id: String(r.id || r._id),
            userName: reviewUserMap.get(String(r.user_id)) || "Unknown",
            podCode: booking ? reviewPodMap.get(booking.pod_id) || "N/A" : "N/A",
            bookingId: r.booking_id || "",
            rating: r.rating || 0,
            comment: r.comment || null,
            isRejected: normalizeIsRejected(r.is_rejected),
            createdAt: r.created_at || r.createdAt || null,
          };
        }),
      };

      const [
        totalActive,
        usedInPeriod,
        totalDiscountAgg,
        topVoucherAgg,
      ] = await Promise.all([
        vouchersCol.countDocuments({ is_active: true }),
        bookingVouchersCol.countDocuments({ applied_at: { $gte: range.from, $lte: range.to } }),
        bookingVouchersCol
          .aggregate([
            { $match: { applied_at: { $gte: range.from, $lte: range.to } } },
            { $group: { _id: null, total: { $sum: "$discount_amount" } } },
          ])
          .toArray(),
        bookingVouchersCol
          .aggregate([
            { $match: { applied_at: { $gte: range.from, $lte: range.to } } },
            {
              $group: {
                _id: "$voucher_id",
                usageCount: { $sum: 1 },
                totalDiscount: { $sum: "$discount_amount" },
              },
            },
            { $sort: { usageCount: -1 } },
            { $limit: 10 },
          ])
          .toArray(),
      ]);

      const topVoucherIds = topVoucherAgg.map((v) => v._id).filter(Boolean);
      const voucherDocs = await vouchersCol.find({ id: { $in: topVoucherIds } }).toArray();
      const voucherMap = new Map(voucherDocs.map((v) => [v.id, v]));

      vouchers = {
        totalActive,
        usedInPeriod,
        totalDiscountGiven: totalDiscountAgg[0] ? Number(totalDiscountAgg[0].total || 0) : 0,
        topVouchers: topVoucherAgg.map((v) => {
          const voucher = voucherMap.get(v._id) || {};
          return {
            code: voucher.code || "N/A",
            description: voucher.description || "",
            discountType: voucher.discount_type || "",
            usageCount: v.usageCount,
            totalDiscount: Number(v.totalDiscount || 0),
          };
        }),
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        revenue: {
          totalAllTime: totalAllTimeRevenueAgg[0] ? Number(totalAllTimeRevenueAgg[0].total || 0) : 0,
          periodRevenue: periodRevenueAgg[0] ? Number(periodRevenueAgg[0].total || 0) : 0,
          successfulPayments,
          refundedAmount: refundedAmountAgg[0] ? Number(refundedAmountAgg[0].total || 0) : 0,
          byMethod: revenueByMethod,
          byStatus: revenueByStatus,
          recentTransactions: recentPayments.map((p) => ({
            id: p.id || String(p._id),
            orderId: p.order_id,
            type: p.type,
            amount: p.amount,
            currency: p.currency || "VND",
            status: p.status,
            created_at: p.created_at,
          })),
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          newInPeriod: newUsersInPeriod,
          byRole: usersByRole,
        },
        locations,
        reviews,
        vouchers,
      },
    });
  } catch (error) {
    console.error("Get admin stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching admin stats",
    });
  }
};