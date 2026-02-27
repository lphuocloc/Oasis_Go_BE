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

class AuthService {
    /**
     * Đăng ký user mới với email/password
     */
    async register({ email, password, name }) {
        // Validate input
        if (!email || !password) {
            throw new Error("Email and password are required");
        }

        if (password.length < 6) {
            throw new Error("Password must be at least 6 characters");
        }

        // Kiểm tra email đã tồn tại chưa
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            const error = new Error("Email already registered. Please login with your original method.");
            error.statusCode = 409;
            error.authProvider = existingUser.authProvider;
            throw error;
        }

        // Generate OTP
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

        // Tạo user mới
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
            // Nếu gửi email thất bại, xoá user
            await User.findByIdAndDelete(user._id);
            throw new Error("Failed to send verification email. Please try again.");
        }

        return {
            email: user.email,
            message: "OTP sent to your email. Valid for 5 minutes.",
        };
    }

    /**
     * Xác thực OTP
     */
    async verifyOtp({ email, otp }) {
        // Validate input
        if (!email || !otp) {
            throw new Error("Email and OTP are required");
        }

        // Tìm user
        const user = await User.findOne({ email });

        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        // Kiểm tra user đã verify chưa
        if (user.isVerified) {
            const error = new Error("Email already verified. Please login.");
            error.statusCode = 400;
            throw error;
        }

        // Kiểm tra OTP hết hạn
        if (!user.otpExpires || user.otpExpires < new Date()) {
            const error = new Error("OTP has expired. Please request a new one.");
            error.statusCode = 400;
            throw error;
        }

        // Kiểm tra OTP đúng không
        if (user.otp !== otp) {
            const error = new Error("Invalid OTP code");
            error.statusCode = 400;
            throw error;
        }

        // Verify thành công - cập nhật user
        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        user.otpRequestCount = 0;
        await user.save();

        // Tạo token
        const token = generateToken(user._id);

        return {
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                authProvider: user.authProvider,
            },
        };
    }

    /**
     * Đăng nhập với email/password
     */
    async login({ email, password }) {
        // Validate input
        if (!email || !password) {
            throw new Error("Email and password are required");
        }

        // Tìm user và include password
        const user = await User.findOne({ email }).select("+password");

        if (!user) {
            const error = new Error("Invalid credentials");
            error.statusCode = 401;
            throw error;
        }

        // Kiểm tra auth provider
        if (user.authProvider !== "local") {
            const error = new Error(`Please login with ${user.authProvider}`);
            error.statusCode = 400;
            throw error;
        }

        // Kiểm tra email đã verify chưa
        if (!user.isVerified) {
            const error = new Error("Email not verified. Please verify your email first.");
            error.statusCode = 403;
            throw error;
        }

        // Kiểm tra password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            const error = new Error("Invalid credentials");
            error.statusCode = 401;
            throw error;
        }

        // Tạo token
        const token = generateToken(user._id);

        return {
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                authProvider: user.authProvider,
            },
        };
    }

    /**
     * Gửi lại OTP
     */
    async resendOtp({ email }) {
        if (!email) {
            throw new Error("Email is required");
        }

        const user = await User.findOne({ email });

        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (user.isVerified) {
            const error = new Error("Email already verified. Please login.");
            error.statusCode = 400;
            throw error;
        }

        // Kiểm tra rate limit
        const rateLimitCheck = checkOTPRateLimit(user);

        if (!rateLimitCheck.allowed) {
            const error = new Error(rateLimitCheck.message);
            error.statusCode = 429;
            throw error;
        }

        // Generate OTP mới
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

        // Update user
        if (rateLimitCheck.resetCount) {
            user.otpRequestCount = 1;
        } else {
            user.otpRequestCount += 1;
        }

        user.otp = otp;
        user.otpExpires = otpExpires;
        user.otpLastRequestAt = new Date();
        await user.save();

        // Gửi OTP
        await sendOTPEmail(email, otp);

        return {
            message: "OTP sent successfully. Valid for 5 minutes.",
            email: user.email,
        };
    }

    /**
     * Đăng nhập với Firebase (Google/Facebook)
     */
    async loginWithFirebase({ idToken, authProvider }) {
        if (!idToken || !authProvider) {
            throw new Error("idToken and authProvider are required");
        }

        // Verify Firebase token
        const decodedToken = await verifyFirebaseToken(idToken);

        if (!decodedToken) {
            const error = new Error("Invalid Firebase token");
            error.statusCode = 401;
            throw error;
        }

        const { email, name, picture, uid } = decodedToken;

        if (!email) {
            throw new Error("Email not found in Firebase token");
        }

        // Tìm hoặc tạo user
        let user = await User.findOne({ email });

        if (user) {
            // User đã tồn tại - kiểm tra auth provider
            if (user.authProvider !== authProvider) {
                const error = new Error(
                    `Email already registered with ${user.authProvider}. Please use that method to login.`
                );
                error.statusCode = 409;
                throw error;
            }

            // Cập nhật thông tin nếu cần
            user.firebaseUid = uid;
            if (picture) user.profilePicture = picture;
            await user.save();
        } else {
            // Tạo user mới
            user = await User.create({
                email,
                name: name || email.split("@")[0],
                authProvider,
                firebaseUid: uid,
                profilePicture: picture,
                isVerified: true, // Firebase users đã verified
            });
        }

        // Tạo JWT token
        const token = generateToken(user._id);

        return {
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                authProvider: user.authProvider,
                profilePicture: user.profilePicture,
            },
        };
    }

    /**
     * Lấy thông tin user hiện tại
     */
    async getCurrentUser(userId) {
        const user = await User.findById(userId).populate({
            path: "identityCard",
            select: "status",
        });

        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        return {
            id: user._id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            role: user.role,
            authProvider: user.authProvider,
            avatar: user.avatar,
            profilePicture: user.profilePicture,
            isVerified: user.isVerified,
            createdAt: user.createdAt,
            identityCardStatus: user.identityCard?.status || "unverified",
        };
    }

    /**
     * Cập nhật profile user
     */
    async updateProfile(userId, { name, profilePicture, phone }) {
        const user = await User.findById(userId);

        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (name) user.name = name;
        if (profilePicture) user.profilePicture = profilePicture;
        if (phone) user.phone = phone;

        await user.save();

        return {
            id: user._id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            role: user.role,
            authProvider: user.authProvider,
            avatar: user.avatar,
            profilePicture: user.profilePicture,
        };
    }

    /**
     * Đổi mật khẩu
     */
    async changePassword(userId, { currentPassword, newPassword }) {
        if (!currentPassword || !newPassword) {
            throw new Error("Current password and new password are required");
        }

        if (newPassword.length < 6) {
            throw new Error("New password must be at least 6 characters");
        }

        const user = await User.findById(userId).select("+password");

        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (user.authProvider !== "local") {
            const error = new Error(`Cannot change password for ${user.authProvider} accounts`);
            error.statusCode = 400;
            throw error;
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            const error = new Error("Current password is incorrect");
            error.statusCode = 401;
            throw error;
        }

        // Update password
        user.password = newPassword;
        await user.save();

        return {
            message: "Password changed successfully",
        };
    }
}

module.exports = new AuthService();
