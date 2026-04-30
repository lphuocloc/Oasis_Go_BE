const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const LOST_ITEM_REQUEST_STATUSES = ["PENDING", "MATCHED", "CLOSED", "REJECTED"];

/**
 * LostItemRequest — Yêu cầu tìm đồ thất lạc do User tự tạo.
 *
 * User khai báo thông tin đồ bị mất. Manager đối chiếu với LostFoundItem.description
 * để tìm và xác nhận khớp thủ công.
 *
 * Luồng:
 *   PENDING → MATCHED (Manager xác nhận khớp với LostFoundItem)
 *   MATCHED → CLOSED (Sau khi bàn giao thành công / hoặc User hủy)
 *   PENDING → REJECTED (Manager từ chối, không tìm thấy)
 */
const lostItemRequestSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      required: true,
    },
    // User đang yêu cầu
    user_id: {
      type: String,
      required: [true, "user_id is required"],
      ref: "User",
      index: true,
    },
    // Booking mà user nghĩ đã để quên đồ (tuỳ chọn)
    booking_id: {
      type: String,
      default: null,
      ref: "Booking",
      index: true,
    },
    // Tên đồ vật user tự khai — đối chiếu với LostFoundItem.item_name
    item_name_reported: {
      type: String,
      required: [true, "item_name_reported is required"],
      trim: true,
    },
    // Mô tả đặc điểm — đối chiếu chính với LostFoundItem.description
    description_reported: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      default: "PENDING",
      enum: {
        values: LOST_ITEM_REQUEST_STATUSES,
        message: "{VALUE} is not a valid status",
      },
      index: true,
    },
    // FK → LostFoundItem khi Manager xác nhận khớp
    matched_found_item_id: {
      type: String,
      default: null,
      ref: "LostFoundItem",
      index: true,
    },
    // Ghi chú từ Manager khi duyệt / từ chối
    manager_note: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

lostItemRequestSchema.index({ user_id: 1, created_at: -1 });
lostItemRequestSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model("LostItemRequest", lostItemRequestSchema);
