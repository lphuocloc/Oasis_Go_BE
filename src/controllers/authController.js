const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");
const { verifyFirebaseToken } = require("../config/firebase");

// Tạo JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// Kiểm tra rate limit OTP (max 3 lần / 15 phút)
const checkOTPRateLimit = (user) => {
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Reset counter nếu đã quá 15 phút
  if (!user.otpLastRequestAt || user.otpLastRequestAt < fifteenMinutesAgo) {
    return { allowed: true, resetCount: true };
  }

  // Kiểm tra số lần request
  if (user.otpRequestCount >= 3) {
    const timeLeft = Math.ceil(
      (user.otpLastRequestAt.getTime() + 15 * 60 * 1000 - now.getTime()) /
      1000 /
      60,
    );
    return {
      allowed: false,
      resetCount: false,
      message: `Too many OTP requests. Please try again in ${timeLeft} minute(s).`,
    };
  }

  return { allowed: true, resetCount: false };
};

// @desc    Đăng ký bằng email/password với OTP
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Kiểm tra email đã tồn tại chưa (bất kể provider nào)
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          "Email already registered. Please login with your original method.",
        authProvider: existingUser.authProvider,
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    // Tạo user mới với local auth (chưa verify)
    const user = await User.create({
      email,
      password,
      name,
      authProvider: "local",
      isVerified: false,
      otp,
      otpExpires,
      otpRequestCount: 1,
      otpLastRequestAt: new Date(),
    });

    // Gửi OTP qua email
    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      // Nếu gửi email thất bại, xoá user và báo lỗi
      await User.findByIdAndDelete(user._id);
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email. Please try again.",
      });
    }

    res.status(201).json({
      success: true,
      message:
        "Registration successful. Please check your email for OTP verification code.",
      data: {
        email: user.email,
        message: "OTP sent to your email. Valid for 5 minutes.",
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
};

// @desc    Xác thực OTP
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    // Tìm user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Kiểm tra user đã verify chưa
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified. Please login.",
      });
    }

    // Kiểm tra OTP có tồn tại không
    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new one.",
      });
    }

    // Kiểm tra OTP có hết hạn không
    if (new Date() > user.otpExpires) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    // Kiểm tra OTP có đúng không
    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // OTP hợp lệ - Kích hoạt tài khoản
    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    user.otpRequestCount = 0;
    user.otpLastRequestAt = null;
    await user.save();

    // Tạo JWT token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: "Email verified successfully. You can now login.",
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          authProvider: user.authProvider,
          isVerified: user.isVerified,
        },
        token,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during OTP verification",
    });
  }
};

// @desc    Gửi lại OTP
// @route   POST /api/auth/resend-otp
// @access  Public
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Tìm user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Kiểm tra user đã verify chưa
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified. Please login.",
      });
    }

    // Kiểm tra rate limit
    const rateLimitCheck = checkOTPRateLimit(user);

    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitCheck.message,
      });
    }

    // Generate OTP mới
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    // Cập nhật OTP và counter
    if (rateLimitCheck.resetCount) {
      user.otpRequestCount = 1;
    } else {
      user.otpRequestCount += 1;
    }

    user.otp = otp;
    user.otpExpires = otpExpires;
    user.otpLastRequestAt = new Date();
    await user.save();

    // Gửi OTP qua email
    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email. Please try again.",
      });
    }

    res.status(200).json({
      success: true,
      message: "OTP resent successfully. Please check your email.",
      data: {
        email: user.email,
        message: "OTP sent to your email. Valid for 5 minutes.",
        remainingAttempts: 3 - user.otpRequestCount,
      },
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during OTP resend",
    });
  }
};

// @desc    Đăng nhập bằng email/password
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Tìm user theo email
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Kiểm tra authProvider
    if (user.authProvider !== "local") {
      return res.status(403).json({
        success: false,
        message: `This email is registered with ${user.authProvider}. Please login using that method.`,
        authProvider: user.authProvider,
      });
    }

    // Kiểm tra password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Kiểm tra email đã verify chưa
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email before logging in. Check your email for OTP.",
        requiresVerification: true,
      });
    }

    // Kiểm tra account có active không
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
      });
    }

    // Tạo token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          authProvider: user.authProvider,
        },
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

// @desc    Đăng nhập bằng Google Firebase
// @route   POST /api/auth/google
// @access  Public
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    // Validate input
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Firebase ID token is required",
      });
    }

    // Verify Firebase token
    const verificationResult = await verifyFirebaseToken(idToken);

    if (!verificationResult.success) {
      return res.status(401).json({
        success: false,
        message: "Invalid Firebase token",
        error: verificationResult.error,
      });
    }

    const { uid, email, name, picture, emailVerified } =
      verificationResult.data;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not found in Firebase token",
      });
    }

    // Tìm user theo email
    let user = await User.findOne({ email });

    // Case 1: Email chưa tồn tại - Tạo user mới
    if (!user) {
      user = await User.create({
        email,
        googleId: uid,
        name: name || email.split("@")[0],
        avatar: picture,
        authProvider: "google",
        isVerified: emailVerified || true, // Google users are pre-verified
      });

      const token = generateToken(user._id);

      return res.status(201).json({
        success: true,
        message: "Google authentication successful",
        isNewUser: true,
        data: {
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            authProvider: user.authProvider,
            avatar: user.avatar,
            isVerified: user.isVerified,
          },
          token,
        },
      });
    }

    // Case 2: Email đã tồn tại nhưng authProvider = 'local'
    if (user.authProvider === "local") {
      return res.status(403).json({
        success: false,
        message:
          "This email is already registered with email/password. Please login using that method.",
        authProvider: user.authProvider,
      });
    }

    // Case 3: Email tồn tại và authProvider = 'google'
    if (user.authProvider === "google") {
      // Kiểm tra googleId có khớp không
      if (user.googleId !== uid) {
        return res.status(403).json({
          success: false,
          message:
            "Google account mismatch. This email is linked to a different Google account.",
        });
      }

      // Kiểm tra account có active không
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated",
        });
      }

      // Cập nhật thông tin nếu có thay đổi
      let updated = false;
      if (name && name !== user.name) {
        user.name = name;
        updated = true;
      }
      if (picture && picture !== user.avatar) {
        user.avatar = picture;
        updated = true;
      }
      if (!user.isVerified && emailVerified) {
        user.isVerified = true;
        updated = true;
      }

      if (updated) {
        await user.save();
      }

      const token = generateToken(user._id);

      return res.status(200).json({
        success: true,
        message: "Google authentication successful",
        isNewUser: false,
        data: {
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            authProvider: user.authProvider,
            avatar: user.avatar,
            isVerified: user.isVerified,
          },
          token,
        },
      });
    }
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during Google authentication",
    });
  }
};

// @desc    Lấy thông tin user hiện tại
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          authProvider: user.authProvider,
          avatar: user.avatar,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// @desc    Cập nhật thông tin hồ sơ (Tên và Ảnh)
// @route   PUT /api/auth/update-profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (name) {
      user.name = name;
    }

    if (avatar) {
      user.avatar = avatar;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: user.avatar,
          authProvider: user.authProvider,
          token: user.token,
        },
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during profile update",
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
