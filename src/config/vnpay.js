// VNPay Configuration
// Documentation: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html

const vnpayConfig = {
    // VNPay Terminal Code (Mã định danh merchant kết nối)
    vnp_TmnCode: process.env.VNP_TMN_CODE || 'YOUR_TMN_CODE',

    // Secret Key để tạo và xác thực chữ ký
    vnp_HashSecret: process.env.VNP_HASH_SECRET || 'YOUR_HASH_SECRET',

    // URL VNPay Gateway (Sandbox)
    vnp_Url: process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',

    // URL return sau khi thanh toán (người dùng redirect về)
    // Sẽ được config qua environment variable với ngrok URL
    vnp_ReturnUrl: process.env.VNP_RETURN_URL || 'http://localhost:3000/api/vnpay/return',

    // URL IPN callback (VNPay gọi để notify kết quả)
    // Sẽ được config qua environment variable với ngrok URL
    vnp_IpnUrl: process.env.VNP_IPN_URL || 'http://localhost:3000/api/vnpay/ipn',

    // API Version
    vnp_Version: '2.1.0',

    // Command (Pay = thanh toán)
    vnp_Command: 'pay',

    // Currency Code (VND)
    vnp_CurrCode: 'VND',

    // Locale (vn = Tiếng Việt, en = English)
    vnp_Locale: 'vn'
};

module.exports = vnpayConfig;
