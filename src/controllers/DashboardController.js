const mongoose = require("mongoose");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");
const Booking = require("../models/Bookings");
const BookingOrder = require("../models/BookingOrder");
const Incident = require("../models/Incidents");
const User = require("../models/User");
const Location = require("../models/Location");
const Transaction = require("../models/Transaction");

const OPEN_INCIDENT_STATUSES = ["PENDING", "INVESTIGATING"];
const SUCCESS_PAYMENT_STATUSES = ["SUCCESS"];
const SUCCESS_ORDER_STATUSES = ["PAID"];

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

const isValidRange = (range) =>
  Boolean(
    range &&
    range.from instanceof Date &&
    range.to instanceof Date &&
    !Number.isNaN(range.from.getTime()) &&
    !Number.isNaN(range.to.getTime()) &&
    range.from <= range.to
  );

const buildDateRangeFilter = (fieldName, range) => ({
  [fieldName]: {
    $gte: range.from,
    $lte: range.to,
  },
});

const resolveRevenueGranularity = (value) => {
  const normalized = String(value || "day").toLowerCase();
  if (["day", "week", "month", "year"].includes(normalized)) {
    return normalized;
  }
  return "day";
};

const getRevenueBucketFormat = (granularity) => {
  if (granularity === "week") return "%G-W%V";
  if (granularity === "month") return "%Y-%m";
  if (granularity === "year") return "%Y";
  return "%Y-%m-%d";
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
    const { from, to, groupBy = "hour" } = req.query;
    const range = getDateRange(from, to);
    const rangeFrom = range.from;
    const rangeTo = range.to;
    const isManager = req.user && req.user.role === "manager";
    const scopedPodIds = isManager
      ? new Set(((req.managerScope && req.managerScope.podIds) || []).map((id) => String(id)))
      : null;
    const scopedClusterIds = isManager
      ? new Set(((req.managerScope && req.managerScope.clusterIds) || []).map((id) => String(id)))
      : null;

    const podService = require("../services/podService");
    const bookingService = require("../services/bookingService");
    const incidentService = require("../services/incidentService");

    const podFilters = {};
    const bookingFilters = { start_date: rangeFrom, end_date: rangeTo };
    if (isManager) {
      bookingFilters.pod_ids = Array.from(scopedPodIds);
    }
    const incidentFilters = {};

    const [podsRaw, bookingsResult, incidentsRaw, clustersTotalRaw] = await Promise.all([
      podService.getAllPods(podFilters),
      bookingService.getAllBookings(bookingFilters),
      incidentService.getIncidents(incidentFilters),
      PodCluster.countDocuments({}),
    ]);

    const pods = isManager
      ? podsRaw.filter((pod) => scopedPodIds.has(String(pod.id)))
      : podsRaw;

    const podMongoIdSet = new Set(pods.map((pod) => String(pod._id)).filter(Boolean));
    const podBusinessIdSet = new Set(pods.map((pod) => String(pod.id)).filter(Boolean));

    const rawBookings = Array.isArray(bookingsResult && bookingsResult.bookings)
      ? bookingsResult.bookings
      : [];
    const bookings = isManager
      ? rawBookings.filter((booking) => scopedPodIds.has(String(booking.pod_id)))
      : rawBookings;

    const incidents = isManager
      ? incidentsRaw.filter((incident) => {
        const incidentPodMongoId = incident.podId || (incident.pod && incident.pod._id) || null;
        const incidentPodBusinessId = incident.pod_id || (incident.pod && incident.pod.id) || null;
        if (incidentPodMongoId && podMongoIdSet.has(String(incidentPodMongoId))) return true;
        if (incidentPodBusinessId && podBusinessIdSet.has(String(incidentPodBusinessId))) return true;
        return false;
      })
      : incidentsRaw;

    const clustersTotal = isManager
      ? scopedClusterIds.size
      : clustersTotalRaw;

    const normalizeStatus = (status) => {
      if (!status) return "UNKNOWN";
      return String(status).trim().toUpperCase();
    };

    const getBookingAmount = (booking) => {
      const raw = booking.total_price != null ? booking.total_price : booking.base_price;
      const amount = Number(raw || 0);
      return Number.isFinite(amount) ? amount : 0;
    };

    const bookingStatusCounts = countByField(
      bookings.map((booking) => ({
        ...booking,
        status: normalizeStatus(booking.status),
      })),
      "status"
    );
    const podStatusCounts = countByField(
      pods.map((pod) => ({
        ...pod,
        status: normalizeStatus(pod.status),
      })),
      "status"
    );

    const bookingStatusDenominator = bookings.length || 1;
    const podStatusDenominator = pods.length || 1;

    const bookingStatusRating = buildPieData(bookingStatusCounts).map((item) => ({
      status: item.status,
      count: item.count,
      rate: Number(((item.count / bookingStatusDenominator) * 100).toFixed(2)),
    }));
    const podStatusRealtime = buildPieData(podStatusCounts).map((item) => ({
      status: item.status,
      count: item.count,
      rate: Number(((item.count / podStatusDenominator) * 100).toFixed(2)),
    }));

    const nonRevenueStatuses = new Set(["CANCELLED", "FAILED", "EXPIRED"]);
    const billableBookings = bookings.filter(
      (booking) => !nonRevenueStatuses.has(normalizeStatus(booking.status))
    );
    const revenueInRange = billableBookings.reduce((sum, booking) => sum + getBookingAmount(booking), 0);

    const resolvedGroupBy = ["hour", "day", "month"].includes(String(groupBy))
      ? String(groupBy)
      : "hour";
    const toBucketKey = (dateValue) => {
      const d = toDateOrNull(dateValue);
      if (!d) return null;

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");

      if (resolvedGroupBy === "month") return `${yyyy}-${mm}`;
      if (resolvedGroupBy === "day") return `${yyyy}-${mm}-${dd}`;
      return `${yyyy}-${mm}-${dd} ${hh}:00`;
    };

    const revenueBucketMap = new Map();
    billableBookings.forEach((booking) => {
      const bookingTime = booking.start_time || booking.start_date || booking.createdAt;
      const bucket = toBucketKey(bookingTime);
      if (!bucket) return;
      revenueBucketMap.set(bucket, (revenueBucketMap.get(bucket) || 0) + getBookingAmount(booking));
    });

    const revenueTrend = Array.from(revenueBucketMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, amount]) => ({ label, amount: Number(amount.toFixed(2)) }));

    const incidentsByStatus = countByField(
      incidents.map((incident) => ({
        ...incident,
        status: normalizeStatus(incident.status),
      })),
      "status"
    );
    const openIncidents = incidents.filter((incident) =>
      OPEN_INCIDENT_STATUSES.includes(normalizeStatus(incident.status))
    ).length;

    const summary = {
      podsTotal: pods.length,
      clustersTotal,
      bookingsInRange: bookings.length,
      incidentsTotal: incidents.length,
      openIncidents,
      revenueInRange: Number(revenueInRange.toFixed(2)),
    };

    return res.status(200).json({
      success: true,
      data: {
        summary,
        ratings: {
          bookingStatus: bookingStatusRating,
          podStatusRealtime,
        },
        charts: {
          bookingStatus: bookingStatusRating,
          podStatusRealtime,
          revenueTrend: {
            groupBy: resolvedGroupBy,
            points: revenueTrend,
          },
        },
        pods: {
          list: pods,
          statusSummary: podStatusRealtime,
        },
        bookings: {
          from: rangeFrom,
          to: rangeTo,
          list: bookings,
          statusSummary: bookingStatusRating,
          revenue: {
            total: Number(revenueInRange.toFixed(2)),
          },
        },
        incidents: {
          list: incidents,
          byStatus: buildPieData(incidentsByStatus),
        },
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

exports.getRevenueSeries = async (req, res) => {
  try {
    const { from, to, granularity } = req.query;
    const range = getDateRange(from, to);

    if (!isValidRange(range)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range",
      });
    }

    const resolvedGranularity = resolveRevenueGranularity(granularity);
    const bucketFormat = getRevenueBucketFormat(resolvedGranularity);

    const points = await Transaction.aggregate([
      {
        $match: {
          ...buildDateRangeFilter("created_at", range),
          status: { $in: SUCCESS_PAYMENT_STATUSES },
          type: { $in: ["CHARGE", "REFUND"] },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: bucketFormat,
              date: "$created_at",
              timezone: "UTC",
            },
          },
          chargeAmount: {
            $sum: {
              $cond: [{ $eq: ["$type", "CHARGE"] }, "$amount", 0],
            },
          },
          refundAmount: {
            $sum: {
              $cond: [{ $eq: ["$type", "REFUND"] }, "$amount", 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dataPoints = points.map((item) => {
      const chargeAmount = Number(item.chargeAmount || 0);
      const refundAmount = Number(item.refundAmount || 0);
      const netRevenue = chargeAmount - refundAmount;

      return {
        label: item._id,
        chargeAmount: Number(chargeAmount.toFixed(2)),
        refundAmount: Number(refundAmount.toFixed(2)),
        netRevenue: Number(netRevenue.toFixed(2)),
      };
    });

    const totals = dataPoints.reduce(
      (acc, point) => {
        acc.chargeAmount += point.chargeAmount;
        acc.refundAmount += point.refundAmount;
        acc.netRevenue += point.netRevenue;
        return acc;
      },
      {
        chargeAmount: 0,
        refundAmount: 0,
        netRevenue: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        range,
        granularity: resolvedGranularity,
        points: dataPoints,
        totals: {
          chargeAmount: Number(totals.chargeAmount.toFixed(2)),
          refundAmount: Number(totals.refundAmount.toFixed(2)),
          netRevenue: Number(totals.netRevenue.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error("Get revenue series error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching revenue series",
    });
  }
};

exports.getOrderSuccessRate = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = getDateRange(from, to);

    if (!isValidRange(range)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range",
      });
    }

    const dateFilter = buildDateRangeFilter("createdAt", range);

    const [totalOrders, successOrders, byStatus] = await Promise.all([
      BookingOrder.countDocuments(dateFilter),
      BookingOrder.countDocuments({
        ...dateFilter,
        status: { $in: SUCCESS_ORDER_STATUSES },
      }),
      BookingOrder.aggregate([
        { $match: dateFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", count: 1 } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const successRate = totalOrders > 0 ? Number(((successOrders / totalOrders) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      success: true,
      data: {
        range,
        totalOrders,
        successOrders,
        failedOrders: Math.max(0, totalOrders - successOrders),
        successRate,
        byStatus,
      },
    });
  } catch (error) {
    console.error("Get order success rate error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching order success rate",
    });
  }
};

exports.getBookingsByCluster = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = getDateRange(from, to);

    if (!isValidRange(range)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range",
      });
    }

    const clusterStats = await Booking.aggregate([
      { $match: buildDateRangeFilter("start_time", range) },
      {
        $lookup: {
          from: "pods",
          localField: "pod_id",
          foreignField: "id",
          as: "pod",
        },
      },
      { $unwind: "$pod" },
      {
        $group: {
          _id: "$pod.cluster_id",
          bookingCount: { $sum: 1 },
          grossRevenue: { $sum: { $ifNull: ["$total_price", 0] } },
          statusCounts: {
            $push: "$status",
          },
        },
      },
      {
        $lookup: {
          from: "podclusters",
          localField: "_id",
          foreignField: "id",
          as: "cluster",
        },
      },
      {
        $project: {
          _id: 0,
          clusterId: "$_id",
          clusterName: {
            $ifNull: [{ $arrayElemAt: ["$cluster.name", 0] }, "Unknown cluster"],
          },
          bookingCount: 1,
          grossRevenue: { $round: ["$grossRevenue", 2] },
          statusCounts: 1,
        },
      },
      { $sort: { bookingCount: -1 } },
    ]);

    const data = clusterStats.map((item) => {
      const normalizedStatusCounts = (item.statusCounts || []).reduce((acc, status) => {
        const key = status || "UNKNOWN";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      return {
        clusterId: item.clusterId,
        clusterName: item.clusterName,
        bookingCount: item.bookingCount,
        grossRevenue: Number(item.grossRevenue || 0),
        byStatus: buildPieData(normalizedStatusCounts),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        range,
        clusters: data,
        totals: {
          bookingCount: data.reduce((sum, c) => sum + (c.bookingCount || 0), 0),
          grossRevenue: Number(
            data.reduce((sum, c) => sum + (Number(c.grossRevenue) || 0), 0).toFixed(2)
          ),
        },
      },
    });
  } catch (error) {
    console.error("Get bookings by cluster error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching bookings by cluster",
    });
  }
};

exports.getSummaryCards = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = getDateRange(from, to);

    if (!isValidRange(range)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range",
      });
    }

    const transactionMatch = {
      ...buildDateRangeFilter("created_at", range),
      status: { $in: SUCCESS_PAYMENT_STATUSES },
      type: { $in: ["CHARGE", "REFUND"] },
    };

    const [transactionTotals, totalOrders, successOrders, totalBookings, totalClusters] = await Promise.all([
      Transaction.aggregate([
        { $match: transactionMatch },
        {
          $group: {
            _id: null,
            chargeAmount: {
              $sum: {
                $cond: [{ $eq: ["$type", "CHARGE"] }, "$amount", 0],
              },
            },
            refundAmount: {
              $sum: {
                $cond: [{ $eq: ["$type", "REFUND"] }, "$amount", 0],
              },
            },
          },
        },
      ]),
      BookingOrder.countDocuments(buildDateRangeFilter("createdAt", range)),
      BookingOrder.countDocuments({
        ...buildDateRangeFilter("createdAt", range),
        status: { $in: SUCCESS_ORDER_STATUSES },
      }),
      Booking.countDocuments(buildDateRangeFilter("start_time", range)),
      PodCluster.countDocuments({}),
    ]);

    const chargeAmount = Number(transactionTotals[0]?.chargeAmount || 0);
    const refundAmount = Number(transactionTotals[0]?.refundAmount || 0);
    const successRate = totalOrders > 0 ? Number(((successOrders / totalOrders) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      success: true,
      data: {
        range,
        cards: {
          netRevenue: Number((chargeAmount - refundAmount).toFixed(2)),
          totalBookings,
          totalOrders,
          successfulOrders: successOrders,
          orderSuccessRate: successRate,
          totalClusters,
        },
      },
    });
  } catch (error) {
    console.error("Get summary cards error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching summary cards",
    });
  }
};