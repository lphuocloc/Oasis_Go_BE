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
const bookingAutoActivateJobIntervalMinutes = Number(process.env.BOOKING_AUTO_ACTIVATE_JOB_INTERVAL_MINUTES || 1);
const bookingAutoActivateGraceMinutes = Number(process.env.BOOKING_AUTO_ACTIVATE_GRACE_MINUTES || 15);
bookingService.startAutoActivateCheckinJob(bookingAutoActivateJobIntervalMinutes, bookingAutoActivateGraceMinutes);

const cleaningTaskService = require("./services/cleaningTaskService");
const staffShiftAssignmentService = require("./services/staffShiftAssignmentService");
const debtService = require("./services/debtService");
if (
  String(
    process.env.CLEANING_TASK_BACKFILL_JOB_ENABLED || "false",
  ).toLowerCase() === "true"
) {
  cleaningTaskService.startBackfillJob(
    Number(process.env.CLEANING_TASK_BACKFILL_JOB_INTERVAL_MINUTES || 60),
    {
      cleaner_access_only:
        String(
          process.env.CLEANING_TASK_BACKFILL_CLEANER_ACCESS_ONLY || "true",
        ).toLowerCase() === "true",
      limit: Number(process.env.CLEANING_TASK_BACKFILL_LIMIT || 200),
      dry_run:
        String(
          process.env.CLEANING_TASK_BACKFILL_DRY_RUN || "false",
        ).toLowerCase() === "true",
    },
  );
}

if (
  String(
    process.env.CLEANING_TASK_SLA_REMINDER_JOB_ENABLED || "true",
  ).toLowerCase() === "true"
) {
  cleaningTaskService.startSlaReminderJob(
    Number(process.env.CLEANING_TASK_SLA_REMINDER_JOB_INTERVAL_MINUTES || 5),
    Number(process.env.CLEANING_TASK_SLA_REMINDER_LEAD_MINUTES || 15),
  );
}

if (
  String(process.env.SHIFT_REMINDER_JOB_ENABLED || "true").toLowerCase() ===
  "true"
) {
  staffShiftAssignmentService.startShiftReminderJob(
    Number(process.env.SHIFT_REMINDER_JOB_INTERVAL_MINUTES || 5),
    Number(process.env.SHIFT_REMINDER_LEAD_MINUTES || 30),
  );
}

if (
  String(process.env.DEBT_AGING_JOB_ENABLED || "true").toLowerCase() === "true"
) {
  debtService.startAgingDebtJob(
    Number(process.env.DEBT_AGING_JOB_INTERVAL_HOURS || 24),
  );
}

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
const supportRequestRouter = require("./routes/supportRequest");
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
const inventoryActivityLogRouter = require("./routes/inventoryActivityLog");
const cleaningTaskRouter = require("./routes/cleaningTask");
const cleaningPhotoRouter = require("./routes/cleaningPhoto");
const maintenanceTaskRouter = require("./routes/maintenanceTask");
const staffShiftRouter = require("./routes/staffShift");
const locationShiftRouter = require("./routes/locationShift");
const staffWorkRosterRouter = require("./routes/staffWorkRoster");
const staffShiftAssignmentRouter = require("./routes/staffShiftAssignment");
const staffAttendanceLogRouter = require("./routes/staffAttendanceLog");
const usersRouter = require("./routes/users");
const incidentRouter = require("./routes/incident");
const damageServiceCatalogRouter = require("./routes/damageServiceCatalog");
const lostFoundRouter = require("./routes/lostFound");
const reviewRouter = require("./routes/review");
const notificationRouter = require("./routes/notification");
const cleaningBufferPolicyRouter = require("./routes/cleaningBufferPolicy");
const walletRouter = require("./routes/wallet");
const depositPolicyRouter = require("./routes/depositPolicy");
const voucherRouter = require("./routes/voucher");
const bookingVoucherRouter = require("./routes/bookingVoucher");
const pricingRuleRouter = require("./routes/pricingRule");
const app = express();

const parseAllowedOrigins = (origins = "") =>
  origins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");
const corsOptions = {
  origin: (origin, callback) => {
    // Native mobile/curl requests may not include Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// Middlewares
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
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
app.use("/api/support-requests", supportRequestRouter);
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
app.use("/api/inventory-activity-logs", inventoryActivityLogRouter);
app.use("/api/cleaning-tasks", cleaningTaskRouter);
app.use("/api/cleaning-photos", cleaningPhotoRouter);
app.use("/api/maintenance-tasks", maintenanceTaskRouter);
app.use("/api/staff-shifts", staffShiftRouter);
app.use("/api/location-shifts", locationShiftRouter);
app.use("/api/staff-work-rosters", staffWorkRosterRouter);
app.use("/api/staff-shift-assignments", staffShiftAssignmentRouter);
app.use("/api/staff-attendance-logs", staffAttendanceLogRouter);
app.use("/api/users", usersRouter);
app.use("/api/incidents", incidentRouter);
app.use("/api/damage-service-catalogs", damageServiceCatalogRouter);
app.use("/api/lost-found-items", lostFoundRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/cleaning-buffer-policies", cleaningBufferPolicyRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/deposit-policies", depositPolicyRouter);
app.use("/api/vouchers", voucherRouter);
app.use("/api/booking-vouchers", bookingVoucherRouter);
app.use("/api/pricing-rules", pricingRuleRouter);
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
