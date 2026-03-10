const cccdService = require("../services/cccdService");

exports.getIdentity = async (req, res) => {
  try {
    const data = await cccdService.getIdentityByUserId(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Lỗi hệ thống khi lấy định danh.",
    });
  }
};

exports.updateIdentityFromQR = async (req, res) => {
  try {
    const { qrCode, infor } = req.body;
    const data = await cccdService.updateIdentity(req.user.id, qrCode, infor);
    return res.status(200).json({
      success: true,
      message: "Xác thực danh tính thành công!",
      data,
    });
  } catch (error) {
    console.error("Update Identity Error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Lỗi hệ thống khi xử lý định danh.",
    });
  }
};

exports.resetIdentity = async (req, res) => {
  try {
    await cccdService.resetIdentity(req.user.id);
    return res.status(200).json({
      success: true,
      message: "Đã reset định danh thành công.",
    });
  } catch (error) {
    console.error("Reset Identity Error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Lỗi khi reset định danh.",
    });
  }
};
