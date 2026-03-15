const podService = require("../services/podService");
const bookingService = require("../services/bookingService");
const incidentService = require("../services/incidentService");

exports.getDashboard = async (req, res) => {
  try {
    const { from, to, groupBy = "day" } = req.query;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const rangeFrom = from ? new Date(from) : startOfToday;
    const rangeTo = to ? new Date(to) : endOfToday;

    // 1. Lấy dữ liệu thô
    const [pods, bookingsResult, incidents] = await Promise.all([
      podService.getAllPods({}),                               // tất cả pod
      bookingService.getAllBookings({ start_date: rangeFrom, end_date: rangeTo }), // booking trong khoảng thời gian
      incidentService.getIncidents({ /* nếu muốn có from/to thì thêm filter trong service */ }),
    ]);

    const bookings = bookingsResult.bookings;
    const countBy = (items, field, allKeys = []) => {
      const map = {};
      for (const key of allKeys) map[key] = 0; // đảm bảo luôn có đủ key
      for (const item of items) {
        const k = item[field];
        if (!k) continue;
        map[k] = (map[k] || 0) + 1;
      }
      return map;
    };

    // 3. Summary
    const podsByStatus = countBy(pods, "status", [
      "AVAILABLE",
      "OCCUPIED",
      "NEEDS_CLEANING",
      "CLEANING",
      "MAINTENANCE",
    ]);

    const bookingsByStatus = countBy(bookings, "status", [
      "BOOKED",
      "IN_USE",
      "COMPLETED",
      "CANCELLED",
    ]);

    const incidentsByStatus = countBy(incidents, "status", [
      "PENDING",
      "INVESTIGATING",
      "RESOLVED",
      "CLOSED",
    ]);

    // 4. Charts – ví dụ đơn giản: pie theo status
    const mapToArray = (obj, keyName) =>
      Object.entries(obj).map(([k, v]) => ({ [keyName]: k, count: v }));

    const bookingsStatusPie = mapToArray(bookingsByStatus, "status");
    const incidentsStatusPie = mapToArray(incidentsByStatus, "status");

    // 5. List rút gọn (latest)
    const latestBookings = bookings
      .slice(0, 10)
      .map((b) => ({
        id: b._id,
        podCode: b.podCode || b.pod?.code, // chỉnh theo populate của bạn
        userName: b.userName || b.user?.name,
        startTime: b.startTime,
        endTime: b.endTime,
        status: b.status,
      }));

    const latestIncidents = incidents
      .slice(0, 10)
      .map((i) => ({
        id: i._id,
        podCode: i.podCode || i.pod?.code,
        severity: i.severity,
        status: i.status,
        created_at: i.created_at || i.createdAt,
      }));

    // 6. Trả response luôn đủ khung, kể cả mảng rỗng
    return res.status(200).json({
      success: true,
      data: {
        filters: {
          from: rangeFrom,
          to: rangeTo,
          groupBy,
          tz: "Asia/Ho_Chi_Minh",
          locationId: null,
          clusterId: null,
        },
        summary: {
          pods: {
            total: pods.length,
            byStatus: podsByStatus,
          },
          bookings: {
            totalInRange: bookings.length,
            byStatus: bookingsByStatus,
          },
          incidents: {
            totalInRange: incidents.length,
            // ví dụ openNow = PENDING + INVESTIGATING
            openNow: (incidentsByStatus.PENDING || 0) + (incidentsByStatus.INVESTIGATING || 0),
            byStatus: incidentsByStatus,
          },
        },
        charts: {
          bookingsStatusPie,
          incidentsStatusPie,
          // bookingsOverTime: [] // sau này cần thì thêm
        },
        lists: {
          latestBookings,
          latestIncidents,
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