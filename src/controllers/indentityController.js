const User = require("../models/User");
const IdentityCard = require("../models/IndentityCard");

exports.updateIdentityFromQR = async (req, res) => {
  try {
    const userId = req.user.id;
    const { qrCode, infor } = req.body;
    if (!infor || !infor.idNumber) {
      return res.status(400).json({
        success: false,
        message: "Dữ liệu thông tin (infor) không hợp lệ hoặc thiếu số CCCD.",
      });
    }
    // check tông tại
    const existingCard = await IdentityCard.findOne({
      "extractedInfo.idNumber": infor.idNumber,
      userId: { $ne: userId },
    });

    if (existingCard) {
      return res.status(400).json({
        success: false,
        message: "Số CCCD này đã được sử dụng bởi một tài khoản khác.",
      });
    }

    const identity = await IdentityCard.findOneAndUpdate(
      { userId: userId },
      {
        qrRawData: qrCode,
        extractedInfo: infor,
        status: "verified",
        verifiedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    await User.findByIdAndUpdate(userId, {
      identityCard: identity._id,
    });

    return res.status(200).json({
      success: true,
      message: "Xác thực danh tính thành công!",
      data: identity,
    });
  } catch (error) {
    console.error("Update Identity Error:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi xử lý định danh.",
    });
  }
};
