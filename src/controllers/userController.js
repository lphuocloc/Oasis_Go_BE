const userService = require("../services/userService");

exports.getActiveUsers = async (req, res) => {
  try {
    const users = await userService.getActiveUsers(req.query.role);

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
