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
      message: "Registration successful. Please check your email for OTP verification code.",
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
    const { email, password } = req.body;

    const result = await authService.login({ email, password });

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
    const { idToken } = req.body;

    const result = await authService.loginWithFirebase({ idToken, authProvider: 'google' });

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
      phone
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

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Email không tồn tại" });
    }

    //gửi otp

    const OPT = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.resetPasswordOtp = OPT;
    user.resetPasswordOtpExpires = otpExpires;
    await user.save();

    await sendOTPEmail(email, OPT);

    res.status(200).json({
      success: true,
      message: "OTP reset pass đã được gửi",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to send verification email. Please try again.",
    });
  }
};
// @desc    Xác thực OTP Reset để lấy Reset Token
// @route   POST /api/auth/verify-reset-otp
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (
      !user ||
      user.resetPasswordOtp !== otp ||
      new Date() > user.resetPasswordOtpExpires
    ) {
      return res
        .status(400)
        .json({ success: false, message: "OTP không đúng hoặc hết hạn" });
    }

    // Tạo Reset Token
    const resetPasswordToken = jwt.sign(
      { id: user._id, purpose: "password_reset" },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    );

    // Xóa OTP
    user.resetPasswordOtp = null;
    user.resetPasswordOtpExpires = null;
    await user.save();

    res.status(200).json({
      success: true,
      resetPasswordToken, //lưu trong 10p
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// @desc    Đặt mật khẩu mới
// @route   POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { resetPasswordToken, newPassword } = req.body;

    // Verify token
    const decoded = jwt.verify(resetPasswordToken, process.env.JWT_SECRET);

    if (decoded.purpose !== "password_reset") {
      return res
        .status(401)
        .json({ success: false, message: "Token sai mục đích" });
    }

    const user = await User.findById(decoded.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User không tồn tại" });

    // Cập nhật pass mới
    user.password = newPassword;
    await user.save();

    res
      .status(200)
      .json({ success: true, message: "Mật khẩu đã được cập nhật" });
  } catch (error) {
    // Nếu token hết hạn /-z> jwt.verify sẽ văng lỗi vào đây
    res.status(401).json({
      success: false,
      message: "Phiên làm việc hết hạn, làm lại từ đầu đi gà🐤",
    });
  }
};
