const crypto = require('crypto');
const querystring = require('qs');
const vnpayConfig = require('../config/vnpay');

/**
 * Sắp xếp object theo key (alphabetically)
 */
function sortObject(obj) {
    const sorted = {};
    const str = [];
    let key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            str.push(encodeURIComponent(key));
        }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
        sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+');
    }
    return sorted;
}

/**
 * Tạo secure hash (SHA256 hoặc SHA512)
 */
function createSecureHash(data, secretKey, algorithm = 'sha512') {
    const hmac = crypto.createHmac(algorithm, secretKey);
    const signed = hmac.update(Buffer.from(data, 'utf-8')).digest('hex');
    return signed;
}

/**
 * Tạo URL thanh toán VNPay
 * @param {Object} params - Thông tin thanh toán
 * @param {string} params.orderId - Mã đơn hàng (unique)
 * @param {number} params.amount - Số tiền (VND)
 * @param {string} params.orderInfo - Thông tin đơn hàng
 * @param {string} params.orderType - Loại hàng hóa (vd: 'billpayment', 'other')
 * @param {string} params.ipAddr - IP của khách hàng
 * @param {string} params.locale - Ngôn ngữ (vn/en)
 * @param {string} params.bankCode - Mã ngân hàng (optional, để trống = hiển thị tất cả)
 * @returns {string} Payment URL
 */
function createPaymentUrl(params) {
    const {
        orderId,
        amount,
        orderInfo,
        orderType = 'billpayment',
        ipAddr = '127.0.0.1',
        locale = 'vn',
        bankCode = ''
    } = params;

    // Tạo date theo format yyyyMMddHHmmss (Giờ Việt Nam - UTC+7)
    const date = new Date();

    // Convert sang giờ Việt Nam (UTC+7)
    const vnDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const createDate = vnDate.toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14);

    // Expire time (15 phút sau, giờ Việt Nam)
    const expireDate = new Date(vnDate.getTime() + 15 * 60000);
    const expireDateStr = expireDate.toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14);

    // Tạo vnp_Params
    let vnp_Params = {
        vnp_Version: vnpayConfig.vnp_Version,
        vnp_Command: vnpayConfig.vnp_Command,
        vnp_TmnCode: vnpayConfig.vnp_TmnCode,
        vnp_Locale: locale,
        vnp_CurrCode: vnpayConfig.vnp_CurrCode,
        vnp_TxnRef: orderId,
        vnp_OrderInfo: orderInfo,
        vnp_OrderType: orderType,
        vnp_Amount: amount * 100,
        vnp_ReturnUrl: vnpayConfig.vnp_ReturnUrl,
        vnp_IpAddr: ipAddr,
        vnp_CreateDate: createDate,
        vnp_ExpireDate: expireDateStr
    };

    // Thêm bankCode nếu có
    if (bankCode) {
        vnp_Params.vnp_BankCode = bankCode;
    }

    // Sort params
    vnp_Params = sortObject(vnp_Params);

    // Tạo sign data
    const signData = querystring.stringify(vnp_Params, { encode: false });

    // Tạo secure hash
    const secureHash = createSecureHash(signData, vnpayConfig.vnp_HashSecret);

    // Thêm hash vào params
    vnp_Params['vnp_SecureHash'] = secureHash;

    // Tạo payment URL
    const paymentUrl = vnpayConfig.vnp_Url + '?' + querystring.stringify(vnp_Params, { encode: false });

    return paymentUrl;
}

/**
 * Verify IPN callback từ VNPay
 * @param {Object} vnpParams - Query params từ VNPay
 * @returns {Object} { isValid, message, data }
 */
function verifyIpnCall(vnpParams) {
    const secureHash = vnpParams['vnp_SecureHash'];

    // Xóa các field không tham gia verify
    delete vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_SecureHashType'];

    // Sort params
    const sortedParams = sortObject(vnpParams);

    // Tạo sign data
    const signData = querystring.stringify(sortedParams, { encode: false });

    // Tạo checksum
    const checkSum = createSecureHash(signData, vnpayConfig.vnp_HashSecret);

    // Verify
    if (secureHash === checkSum) {
        // Kiểm tra response code
        const rspCode = vnpParams['vnp_ResponseCode'];

        return {
            isValid: true,
            message: 'Verify success',
            data: {
                orderId: vnpParams['vnp_TxnRef'],
                amount: vnpParams['vnp_Amount'] / 100, // Chia 100 để ra số tiền thực
                orderInfo: vnpParams['vnp_OrderInfo'],
                responseCode: rspCode,
                transactionNo: vnpParams['vnp_TransactionNo'],
                bankCode: vnpParams['vnp_BankCode'],
                payDate: vnpParams['vnp_PayDate'],
                transactionStatus: vnpParams['vnp_TransactionStatus'],
                isSuccess: rspCode === '00' // '00' = Giao dịch thành công
            }
        };
    } else {
        return {
            isValid: false,
            message: 'Invalid signature',
            data: null
        };
    }
}

/**
 * Verify return URL (khi khách hàng redirect về)
 * Tương tự verifyIpnCall nhưng không cần check checksum chặt chẽ
 */
function verifyReturnUrl(vnpParams) {
    return verifyIpnCall(vnpParams);
}

module.exports = {
    sortObject,
    createSecureHash,
    createPaymentUrl,
    verifyIpnCall,
    verifyReturnUrl
};
