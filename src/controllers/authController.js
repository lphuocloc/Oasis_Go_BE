const authService = require("../services/authService");

// @desc    Đăng ký bằng email/password với OTP
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const result = await authService.register({ email, password, name });

    res.status(201).json({
      success: true,
      message:
        "Registration successful. Please check your email for OTP verification code.",
      data: result,
    });
  } catch (error) {
    console.error("Register error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during registration",
      ...(error.authProvider && { authProvider: error.authProvider }),
    });
  }
};

// @desc    Xác thực OTP
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const result = await authService.verifyOtp({ email, otp });

    res.status(200).json({
      success: true,
      message: "Email verified successfully. You can now login.",
      data: result,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during OTP verification",
    });
  }
};

// @desc    Gửi lại OTP
// @route   POST /api/auth/resend-otp
// @access  Public
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await authService.resendOtp({ email });

    res.status(200).json({
      success: true,
      message: "OTP resent successfully. Please check your email.",
      data: result,
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during OTP resend",
    });
  }
};

// @desc    Đăng nhập bằng email/password
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    const result = await authService.login({ email, password, fcmToken });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    console.error("Login error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during login",
    });
  }
};

// @desc    Đăng nhập bằng Google Firebase
// @route   POST /api/auth/google
// @access  Public
// @desc    Đăng nhập bằng Google Firebase
// @route   POST /api/auth/google
// @access  Public
exports.googleAuth = async (req, res) => {
  try {
    const { idToken, fcmToken } = req.body;

    const result = await authService.loginWithFirebase({
      idToken,
      authProvider: "google",
      fcmToken,
    });

    const statusCode = result.user.createdAt ? 201 : 200;

    res.status(statusCode).json({
      success: true,
      message: "Google authentication successful",
      data: result,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during Google authentication",
    });
  }
};

// @desc    Lấy thông tin user hiện tại
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const result = await authService.getCurrentUser(req.user.id);

    res.status(200).json({
      success: true,
      data: { user: result },
    });
  } catch (error) {
    console.error("Get me error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
// @desc    Cập nhật thông tin hồ sơ (Tên, Ảnh và Phone)
// @route   PUT /api/auth/update-profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, avatar, phone } = req.body;
    const userId = req.user.id;

    const result = await authService.updateProfile(userId, {
      name,
      profilePicture: avatar,
      phone,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { user: result },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error during profile update",
    });
  }
};

// @desc    Quên mật khẩu - Gửi OTP
// @route   POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await authService.forgotPassword({ email });

    res.status(200).json({
      success: true,
      message: result.message || "OTP reset pass đã được gửi",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Lỗi server trong qúa trình xử lí.",
    });
  }
};
// @desc    Xác thực OTP Reset để lấy Reset Token
// @route   POST /api/auth/verify-reset-otp
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const result = await authService.verifyResetOtp({ email, otp });

    res.status(200).json({
      success: true,
      resetPasswordToken: result.resetPasswordToken,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};
// @desc    Đặt mật khẩu mới
// @route   POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { resetPasswordToken, newPassword } = req.body;

    const result = await authService.resetPassword({
      resetPasswordToken,
      newPassword,
    });

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.handleUpdateToken = async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.id;

    if (!token) {
      return res.status(400).json({ message: "Token không được để trống" });
    }

    await authService.updatePushToken(userId, token);

    res.status(200).json({
      success: true,
      message: "Cập nhật địa chỉ thiết bị thành công",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.handleLogout = async (req, res) => {
  try {
    const userId = req.user.id;

    await authService.clearPushToken(userId);

    res.status(200).json({
      success: true,
      message: "Đăng xuất và xóa địa chỉ thiết bị thành công",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi đăng xuất",
      error: error.message,
    });
  }
};

// @desc    Lấy danh sách tất cả users/cleaners
// @route   GET /api/auth/users
// @access  Private
exports.getAllUsers = async (req, res) => {
  try {
    const User = require("../models/User");
    const { role } = req.query;

    let query = { isActive: true };
    
    // Filter by role if provided, otherwise return users by default
    if (role) {
      query.role = role;
    } else {
      query.role = "user";
    }

    const users = await User.find(query, {
      _id: 1,
      id: 1,
      name: 1,
      email: 1,
      phone: 1,
      avatar: 1,
      role: 1,
      isActive: 1,
      createdAt: 1,
    }).lean();

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Get all users error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
