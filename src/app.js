require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const connectDB = require("./config/db");

// Connect to MongoDB
connectDB();

// Start booking order cleanup job
const bookingOrderService = require("./services/bookingOrderService");
bookingOrderService.startCleanupJob(5); // Run every 5 minutes

// Start booking auto-activation checkin job
const bookingService = require("./services/bookingService");
bookingService.startAutoActivateCheckinJob(1, 15); // Run every minute, grace period 15 minutes

const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const vnpayRouter = require("./routes/vnpay");
const locationRouter = require("./routes/location");
const podClusterRouter = require("./routes/podCluster");
const podRouter = require("./routes/pod");
const identityCardRouter = require("./routes/IdentityCard");
const dashboardRouter = require("./routes/DashboardRoutes");
const timeSlotRouter = require("./routes/timeSlot");
const bookingRouter = require("./routes/booking");
const bookingSlotRouter = require("./routes/bookingSlot");
const bookingOrderRouter = require("./routes/bookingOrder");
const adminRouter = require("./routes/admin");
const podAmenityRouter = require("./routes/podAmenity");
const doorRouter = require("./routes/door");
const podDeviceRouter = require("./routes/podDevice");
const podQrCodeRouter = require("./routes/podQrCode");
const podItemRouter = require("./routes/podItem");
const itemRouter = require("./routes/item");
const warehouseRouter = require("./routes/warehouse");
const locationWarehouseRouter = require("./routes/locationWarehouse");
const inventoryStockRouter = require("./routes/inventoryStock");
const inventoryCheckoutLogRouter = require("./routes/inventoryCheckoutLog");
const cleaningTaskRouter = require("./routes/cleaningTask");
const cleaningPhotoRouter = require("./routes/cleaningPhoto");
const maintenanceTaskRouter = require("./routes/maintenanceTask");
const staffShiftRouter = require("./routes/staffShift");
const locationShiftRouter = require("./routes/locationShift");
const staffWorkRosterRouter = require("./routes/staffWorkRoster");
const staffShiftAssignmentRouter = require("./routes/staffShiftAssignment");
const app = express();

// Middlewares
app.use(cors());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../public")));

// Routes
app.use("/api/auth", authRouter);
app.use("/api/vnpay", vnpayRouter);
app.use("/api/locations", locationRouter);
app.use("/api/pod-clusters", podClusterRouter);
app.use("/api/pods", podRouter);
app.use("/api/timeslots", timeSlotRouter);
app.use("/api/bookings", bookingRouter);
app.use("/api/booking-slots", bookingSlotRouter);
app.use("/api/booking-orders", bookingOrderRouter);
app.use("/api/admin", adminRouter);
app.use("/api/pod-amenities", podAmenityRouter);
app.use("/api/doors", doorRouter);
app.use("/api/pod-devices", podDeviceRouter);
app.use("/api/pod-qr-codes", podQrCodeRouter);
app.use("/api/pod-items", podItemRouter);
app.use("/api/items", itemRouter);
app.use("/api/warehouses", warehouseRouter);
app.use("/api/location-warehouses", locationWarehouseRouter);
app.use("/api/inventory-stocks", inventoryStockRouter);
app.use("/api/inventory-checkout-logs", inventoryCheckoutLogRouter);
app.use("/api/cleaning-tasks", cleaningTaskRouter);
app.use("/api/cleaning-photos", cleaningPhotoRouter);
app.use("/api/maintenance-tasks", maintenanceTaskRouter);
app.use("/api/staff-shifts", staffShiftRouter);
app.use("/api/location-shifts", locationShiftRouter);
app.use("/api/staff-work-rosters", staffWorkRosterRouter);
app.use("/api/staff-shift-assignments", staffShiftAssignmentRouter);
app.use("/", indexRouter);
app.use("/api/identity", identityCardRouter);
app.use("/api/dashboard", dashboardRouter);
// Swagger Documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Oasis Go API Documentation",
  }),
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err : {},
  });
});

module.exports = app;
