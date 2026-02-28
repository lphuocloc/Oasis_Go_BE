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

const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const vnpayRouter = require("./routes/vnpay");
const locationRouter = require("./routes/location");
const podClusterRouter = require("./routes/podCluster");
const podRouter = require("./routes/pod");
const identityCardRouter = require("./routes/IdentityCard");

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
app.use("/", indexRouter);
app.use("/api/identity", identityCardRouter);
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
