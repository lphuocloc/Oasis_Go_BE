const jwt = require("jsonwebtoken");
const podService = require("../services/podService");
const bookingService = require("../services/bookingService");
const incidentService = require("../services/incidentService");

exports.getDashboard = async (req, res) => {
  try {
    const { from, to } = req.query;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );

    const rangeFrom = from ? new Date(from) : startOfToday;
    const rangeTo = to ? new Date(to) : endOfToday;

    // Sau này nếu staff/manager bị giới hạn theo location/cluster
    // có thể thêm filter ở đây dựa trên req.user
    const podFilters = {};
    const bookingFilters = { from: rangeFrom, to: rangeTo };
    const incidentFilters = {};

    const [pods, bookings, incidents] = await Promise.all([
      podService.getAllPods(podFilters),
      bookingService.getBookings(bookingFilters),
      incidentService.getIncidents(incidentFilters),
    ]);

    const summary = {
      podsTotal: pods.length,
      bookingsInRange: bookings.length,
      incidentsTotal: incidents.length,
    };

    return res.status(200).json({
      success: true,
      data: {
        summary,
        pods: {
          list: pods,
        },
        bookings: {
          from: rangeFrom,
          to: rangeTo,
          list: bookings,
        },
        incidents: {
          list: incidents,
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