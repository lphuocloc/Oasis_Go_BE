const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    password: {
      type: String,
      minlength: [6, "Password must be at least 6 characters"],
      // Password chỉ required khi authProvider = 'local'
      required: function () {
        return this.authProvider === "local";
      },
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      required: true,
      default: "local",
    },
    googleId: {
      type: String,
      default: null,
      // Google ID chỉ có khi authProvider = 'google'
      validate: {
        validator: function (value) {
          if (this.authProvider === "google") {
            return value != null && value.length > 0;
          }
          return true;
        },
        message: "Google ID is required for Google authentication",
      },
    },
    role: {
      type: String,
      enum: ["user", "admin", "manager", "cleaner"],
      default: "user",
    },
    name: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // OTP fields for email verification
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
    otpRequestCount: {
      type: Number,
      default: 0,
    },
    otpLastRequestAt: {
      type: Date,
      default: null,
    },
    // OTP fields for password reset
    resetPasswordOtp: {
      type: String,
      default: null,
    },
    resetPasswordOtpExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Index cho tối ưu query
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });

// Hash password trước khi lưu (chỉ với local auth)
userSchema.pre("save", async function () {
  // Chỉ hash nếu password được modified và là local auth
  if (!this.isModified("password") || this.authProvider !== "local") {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method để so sánh password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (this.authProvider !== "local" || !this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Không trả về password khi convert to JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
