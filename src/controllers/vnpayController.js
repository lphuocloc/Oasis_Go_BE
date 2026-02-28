const paymentService = require("../services/paymentService");

// @desc    Tạo URL thanh toán VNPay
// @route   POST /api/vnpay/create-payment
// @access  Public
exports.createPayment = async (req, res) => {
  try {
    const { bookingId, amount, orderInfo } = req.body;
    
    // Lấy IP của client
    const ipAddr = req.headers["x-forwarded-for"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket.remoteAddress ||
      "127.0.0.1";
    
    const result = await paymentService.createPayment({
      bookingId,
      amount,
      orderInfo,
      ipAddr,
    });
    
    res.status(200).json({
      success: true,
      message: "Payment URL created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Create payment error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating payment",
    });
  }
};

// @desc    VNPay return URL handler
// @route   GET /api/vnpay/return
// @access  Public
exports.vnpayReturn = async (req, res) => {
  try {
    const result = await paymentService.handleVnpayReturn(req.query);
    
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error("VNPay return error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error processing VNPay return",
    });
  }
};

// @desc    VNPay IPN (Instant Payment Notification)
// @route   GET /api/vnpay/ipn
// @access  Public
exports.vnpayIpn = async (req, res) => {
  try {
    const result = await paymentService.handleVnpayReturn(req.query);
    
    // IPN requires specific response format
    if (result.code === "00") {
      return res.status(200).json({ RspCode: "00", Message: "success" });
    } else {
      return res.status(200).json({ RspCode: "99", Message: "failed" });
    }
  } catch (error) {
    console.error("VNPay IPN error:", error);
    res.status(200).json({ RspCode: "99", Message: "error" });
  }
};

// @desc    Query payment status from VNPay
// @route   POST /api/vnpay/query
// @access  Private
exports.queryPaymentStatus = async (req, res) => {
  try {
    const { orderId, transactionDate } = req.body;
    
    const result = await paymentService.queryPaymentStatus({ orderId, transactionDate });
    
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Query payment error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error querying payment status",
    });
  }
};

// @desc    Refund payment
// @route   POST /api/vnpay/refund
// @access  Private (Admin)
exports.refundPayment = async (req, res) => {
  try {
    const { orderId, transactionDate, amount, reason } = req.body;
    
    const ipAddr = req.headers["x-forwarded-for"] ||
      req.connection.remoteAddress ||
      "127.0.0.1";
    
    const result = await paymentService.refundPayment({
      orderId,
      transactionDate,
      amount,
      reason,
      ipAddr,
    });
    
    res.status(200).json({
      success: true,
      message: "Refund request processed",
      data: result,
    });
  } catch (error) {
    console.error("Refund payment error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error processing refund",
    });
  }
};

// @desc    Get payment by orderId
// @route   GET /api/vnpay/payment/:orderId
// @access  Private
exports.getPaymentByOrderId = async (req, res) => {
  try {
    const payment = await paymentService.getPaymentByOrderId(req.params.orderId);
    
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching payment",
    });
  }
};

// @desc    Get payments by bookingId
// @route   GET /api/vnpay/booking/:bookingId
// @access  Private
exports.getPaymentsByBookingId = async (req, res) => {
  try {
    const payments = await paymentService.getAllPayments({
      bookingId: req.params.bookingId,
    });
    
    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching payments",
      error: error.message,
    });
  }
};
