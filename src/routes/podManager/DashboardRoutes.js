const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middlewares/authMiddleware");
const dashboardController = require("../../controllers/podManager/DashboardController");
const { protect } = require("../../middlewares/authMiddleware");

router.get("/dashboard", 
    protect, 
    authMiddleware.authorize("manager"), 
    dashboardController.getDashboard 
);

module.exports = router;