const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("./cccd/IndentityCard");
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
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return (
            v == null || v === "" || /^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(v)
          );
        },
        message: (props) =>
          `${props.value} không phải là số điện thoại hợp lệ!`,
      },
      default: null,
    },

    identityCard: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IndentityCard",
      default: null,
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
    resetPasswordOtp: { type: String },
    resetPasswordOtpExpires: { type: Date },
    resetPasswordToken: { type: String },
  },
  {
    timestamps: true,
  },
);

// Index cho tối ưu query
// Note: email already has unique index from schema definition
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
