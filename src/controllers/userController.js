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
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

exports.createUser = async (req, res) => {
  try {
    const user = await userService.createUser(req.body);

    res.status(201).json({
      success: true,
      message: "Tạo nhân viên thành công!",
      data: user,
    });
  } catch (error) {
    console.error("Create user error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await userService.updateUser(id, req.body);

    res.status(200).json({
      success: true,
      message: "Cập nhật nhân viên thành công!",
      data: user,
    });
  } catch (error) {
    console.error("Update user error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
