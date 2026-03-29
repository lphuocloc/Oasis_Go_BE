const User = require("../models/User");
const IdentityCard = require("../models/cccd/IndentityCard");
const notificationService = require("./notificationService");

class IdentityService {
  // Lấy thông tin định danh chi tiết
  async getIdentityByUserId(userId) {
    const identity = await IdentityCard.findOne({ userId });
    if (!identity) {
      throw {
        status: 404,
        message: "Người dùng chưa thực hiện xác thực danh tính.",
      };
    }
    return identity.extractedInfo;
  }

  // Cập nhật định danh từ QR
  async updateIdentity(userId, qrCode, infor) {
    if (!infor || !infor.idNumber) {
      throw {
        status: 400,
        message: "Dữ liệu thông tin không hợp lệ hoặc thiếu số CCCD.",
      };
    }

    // Kiểm tra trùng lặp số CCCD
    const existingCard = await IdentityCard.findOne({
      "extractedInfo.idNumber": infor.idNumber,
      userId: { $ne: userId },
    });

    if (existingCard) {
      throw {
        status: 400,
        message: "Số CCCD này đã được sử dụng bởi một tài khoản khác.",
      };
    }

    // Cập nhật hoặc tạo mới Identity
    const identity = await IdentityCard.findOneAndUpdate(
      { userId },
      {
        qrRawData: qrCode,
        extractedInfo: infor,
        status: "verified",
        verifiedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    // Link tới bảng User
    const user = await User.findByIdAndUpdate(
      userId,
      { identityCard: identity._id },
      { new: true },
    ).select("name");
    if (user) {
      notificationService
        .sendToUser(userId, {
          title: "Xác thực thành công!",
          message: `Chúc mừng ${user.name}, thông tin định danh của bạn đã được cập nhật.`,
          type: "IDENTITY",
          event_code: "IDENTITY_VERIFIED",
          dedupe_key: `IDENTITY_VERIFIED:${userId}:${identity.id || identity._id}`,
          data: {
            type: "IDENTITY_VERIFIED",
            screen: "/(main)/home",
            action: "identity_verified",
          },
        })
        .catch((err) => console.error("Lỗi gửi thông báo:", err));
    }

    return identity.extractedInfo;
  }

  // Xóa/Reset định danh
  async resetIdentity(userId) {
    const deletedCard = await IdentityCard.findOneAndDelete({ userId });

    if (!deletedCard) {
      throw {
        status: 404,
        message: "Không tìm thấy thông tin định danh để reset.",
      };
    }

    // Gỡ bỏ tham chiếu trong User model
    await User.findByIdAndUpdate(userId, {
      $unset: { identityCard: "" },
    });

    return true;
  }
}

module.exports = new IdentityService();
