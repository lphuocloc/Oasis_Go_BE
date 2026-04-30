const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const LOST_FOUND_STATUSES = ["FOUND", "IN_STORAGE", "CLAIM_PENDING", "RETURNED", "DISPOSED"];

/**
 * Tạo serial number 9 chữ số ngẫu nhiên để định danh vật lý của đồ vật.
 * Dùng để phân biệt 2 đồ vật cùng loại, ví dụ: 2 chiếc ví giống nhau.
 */
const generateSerialNumber = () => {
  return String(Math.floor(100000000 + Math.random() * 900000000));
};

const lostFoundItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    pod_id: {
      type: String,
      default: null,
      ref: "Pod",
      index: true,
    },
    booking_id: {
      type: String,
      default: null,
      ref: "Booking",
      index: true,
    },
    found_by_user_id: {
      type: String,
      required: [true, "found_by_user_id is required"],
      ref: "User",
      index: true,
    },
    // Kho tại location — tham chiếu tới LocationWarehouse → Warehouse
    warehouse_id: {
      type: String,
      default: null,
      ref: "Warehouse",
      index: true,
    },
    item_name: {
      type: String,
      required: [true, "item_name is required"],
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    // Số serial 9 chữ số — tự động tạo bởi hệ thống, không do user nhập
    serial_number: {
      type: String,
      default: generateSerialNumber,
      index: true,
      match: [/^\d{9}$/, "serial_number phải là chuỗi 9 chữ số"],
    },
    found_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      required: true,
      default: "FOUND",
      enum: {
        values: LOST_FOUND_STATUSES,
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
    claimed_by_user_id: {
      type: String,
      default: null,
      ref: "User",
      index: true,
    },
    claimed_at: {
      type: Date,
      default: null,
    },
    // OTP bàn giao — Manager tạo, gửi cho User qua Notification
    handover_otp: {
      type: String,
      default: null,
    },
    handover_otp_expires_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

lostFoundItemSchema.index({ pod_id: 1, created_at: -1 });
lostFoundItemSchema.index({ booking_id: 1, created_at: -1 });
lostFoundItemSchema.index({ found_by_user_id: 1, created_at: -1 });

module.exports = mongoose.model("LostFoundItem", lostFoundItemSchema);
