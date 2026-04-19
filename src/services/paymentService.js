const vnpayService = require("../utils/vnpayService");
const Transaction = require("../models/Transaction");
const BookingOrder = require("../models/BookingOrder");
const Booking = require("../models/Bookings");
const BookingVoucher = require("../models/BookingVoucher");
const Voucher = require("../models/Voucher");
const OnlineKey = require("../models/OnlineKey");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { randomInt } = require("crypto");
const notificationService = require("./notificationService");
const walletService = require("./walletService");
const debtService = require("./debtService");
const mongoose = require("mongoose");

const readEnvMinutes = (key, fallback, min = 0) => {
  const raw = Number(process.env[key]);
  if (Number.isFinite(raw) && raw >= min) {
    return raw;
  }
  return fallback;
};

const CHECKIN_EARLY_WINDOW_MINUTES = readEnvMinutes("BOOKING_CHECKIN_EARLY_WINDOW_MINUTES", 15, 0);
const CHECKIN_EARLY_WINDOW_MS = CHECKIN_EARLY_WINDOW_MINUTES * 60 * 1000;

class PaymentService {
  _parseDateOrThrow(value, fieldName) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      const error = new Error(`Invalid ${fieldName}`);
      error.statusCode = 400;
      throw error;
    }
    return parsed;
  }

  _resolvePayableAmount(bookingOrder) {
    return Number(
      bookingOrder?.payable_total_price ?? bookingOrder?.final_total_price ?? 0,
    );
  }

  async _sumSuccessfulChargeByMethod(orderId, method, session = null) {
    const query = Transaction.find({
      order_id: orderId,
      type: "CHARGE",
      status: "SUCCESS",
      method,
    }).select("amount");

    if (session) {
      query.session(session);
    }

    const transactions = await query;
    return transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  }

  async _sumSuccessfulCharges(orderId, session = null) {
    const query = Transaction.find({
      order_id: orderId,
      type: "CHARGE",
      status: "SUCCESS",
    }).select("amount");

    if (session) {
      query.session(session);
    }

    const transactions = await query;
    return transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  }

  async _incrementVoucherUsageIfNeeded(orderId, session = null) {
    let bookingVoucherQuery = BookingVoucher.findOne({ order_id: orderId }).select(
      "voucher_id",
    );
    if (session) {
      bookingVoucherQuery = bookingVoucherQuery.session(session);
    }

    const bookingVoucher = await bookingVoucherQuery;
    if (!bookingVoucher?.voucher_id) {
      return;
    }

    const voucherUpdateFilter = {
      id: bookingVoucher.voucher_id,
      $or: [
        { usage_limit: null },
        { usage_limit: { $exists: false } },
        { $expr: { $lt: ["$usage_count", "$usage_limit"] } },
      ],
    };

    let voucherUpdateQuery = Voucher.updateOne(
      voucherUpdateFilter,
      { $inc: { usage_count: 1 } },
    );
    if (session) {
      voucherUpdateQuery = voucherUpdateQuery.session(session);
    }

    await voucherUpdateQuery;
  }

  async _settleOrderIfFullyPaid(orderId, session = null) {
    let bookingOrderQuery = BookingOrder.findOne({ id: orderId });
    if (session) {
      bookingOrderQuery = bookingOrderQuery.session(session);
    }

    const bookingOrder = await bookingOrderQuery;
    if (!bookingOrder) return null;

    const payableAmount = this._resolvePayableAmount(bookingOrder);
    const totalCharged = await this._sumSuccessfulCharges(orderId, session);

    if (totalCharged + 0.0001 < payableAmount) {
      return {
        bookingOrder,
        payableAmount,
        totalCharged,
        isPaid: false,
      };
    }

    const walletCharged = await this._sumSuccessfulChargeByMethod(
      orderId,
      "WALLET",
      session,
    );
    const vnpayCharged = await this._sumSuccessfulChargeByMethod(
      orderId,
      "VNPAY",
      session,
    );

    const nextPaymentMethod =
      walletCharged > 0 && vnpayCharged > 0
        ? "HYBRID"
        : walletCharged > 0
          ? "WALLET"
          : "VNPAY";

    let becamePaid = false;
    if (bookingOrder.status !== "PAID") {
      bookingOrder.status = "PAID";
      bookingOrder.payment_method = nextPaymentMethod;
      await bookingOrder.save({ session });
      becamePaid = true;

      await this._incrementVoucherUsageIfNeeded(orderId, session);
    } else {
      bookingOrder.payment_method = nextPaymentMethod;
    }

    return {
      bookingOrder,
      payableAmount,
      totalCharged,
      walletCharged,
      vnpayCharged,
      isPaid: true,
      becamePaid,
    };
  }

  async _generateOnlineKeyToken() {
    const MAX_RETRY = 10;

    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
      const token = String(randomInt(0, 1000000)).padStart(6, "0");
      const exists = await OnlineKey.exists({
        key_token: token,
        is_revoked: false,
      });
      if (!exists) {
        return token;
      }
    }

    const error = new Error("Unable to generate unique online key token");
    error.statusCode = 500;
    throw error;
  }

  async _ensureOnlineKeysForOrder(orderId) {
    const REQUIRED_KEY_TYPES = ["CUSTOMER", "CLEANER"];
    const bookings = await Booking.find({
      order_id: orderId,
      status: { $in: ["BOOKED", "IN_USE", "COMPLETED"] },
    })
      .select("id pod_id user_id start_time end_time")
      .lean();

    if (bookings.length === 0) {
      return { created: 0, totalBookings: 0 };
    }

    const bookingIds = bookings.map((booking) => booking.id);
    const existingKeys = await OnlineKey.find({
      booking_id: { $in: bookingIds },
      key_type: { $in: REQUIRED_KEY_TYPES },
    })
      .select("booking_id key_type")
      .lean();

    const existingKeyByBookingAndType = new Set(
      existingKeys.map((key) => `${key.booking_id}:${key.key_type}`),
    );
    const CLEANER_EXTRA_MINUTES_MS = 30 * 60 * 1000;

    const docsToCreate = [];
    for (const booking of bookings) {
      for (const keyType of REQUIRED_KEY_TYPES) {
        const dedupeKey = `${booking.id}:${keyType}`;
        if (existingKeyByBookingAndType.has(dedupeKey)) {
          continue;
        }

        docsToCreate.push({
          booking_id: booking.id,
          pod_id: booking.pod_id,
          user_id: String(booking.user_id),
          key_type: keyType,
          key_token: await this._generateOnlineKeyToken(),
          valid_from:
            keyType === "CLEANER"
              ? new Date(
                new Date(booking.start_time).getTime() -
                CHECKIN_EARLY_WINDOW_MS,
              )
              : new Date(
                new Date(booking.start_time).getTime() -
                CHECKIN_EARLY_WINDOW_MS,
              ),
          valid_to:
            keyType === "CLEANER"
              ? new Date(
                new Date(booking.end_time).getTime() +
                CLEANER_EXTRA_MINUTES_MS,
              )
              : new Date(booking.end_time),
          is_revoked: false,
        });
      }
    }

    if (docsToCreate.length === 0) {
      return { created: 0, totalBookings: bookings.length };
    }

    try {
      await OnlineKey.insertMany(docsToCreate, { ordered: false });
      return { created: docsToCreate.length, totalBookings: bookings.length };
    } catch (error) {
      const isBulkWriteError =
        error?.name === "BulkWriteError" || error?.code === 11000;
      if (!isBulkWriteError) {
        throw error;
      }

      // Concurrent VNPay return/IPN callbacks may race to insert the same active key.
      // Duplicate-key errors are safe to ignore because the key already exists.
      return { created: 0, totalBookings: bookings.length };
    }
  }

  /**
   * Tạo payment và generate VNPay URL
   */
  async createPayment({ bookingOrderId, orderInfo, ipAddr }) {
    const resolvedBookingOrderId = bookingOrderId;

    // Validate input
    if (!resolvedBookingOrderId || !orderInfo) {
      throw new Error("Missing required fields: bookingOrderId, orderInfo");
    }

    // Use BookingOrder ID as VNPay orderId
    const orderId = resolvedBookingOrderId;

    const bookingOrder = await BookingOrder.findOne({ id: orderId });
    if (!bookingOrder) {
      const error = new Error("Booking order not found");
      error.statusCode = 404;
      throw error;
    }

    if (bookingOrder.status !== "PENDING") {
      const error = new Error(
        `Cannot create transaction for order with status: ${bookingOrder.status}`,
      );
      error.statusCode = 400;
      throw error;
    }

    // ✅ SECURITY: Lấy amount từ BookingOrder, không từ request
    const amount =
      bookingOrder.payable_total_price ?? bookingOrder.final_total_price;

    const existingCharge = await Transaction.findOne({
      order_id: orderId,
      type: "CHARGE",
      status: { $in: ["PENDING", "SUCCESS"] },
    }).sort({ created_at: -1 });

    if (existingCharge && existingCharge.status === "SUCCESS") {
      const error = new Error("Order has already been paid");
      error.statusCode = 400;
      throw error;
    }

    if (existingCharge && existingCharge.status === "PENDING") {
      const paymentUrl = vnpayService.createPaymentUrl({
        orderId,
        amount: parseFloat(existingCharge.amount),
        orderInfo,
        orderType: "billpayment",
        ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
        locale: "vn",
        bankCode: "NCB",
      });

      return {
        transactionId: existingCharge.id,
        orderId,
        amount: existingCharge.amount,
        orderInfo,
        paymentUrl,
        status: existingCharge.status,
        createdAt: existingCharge.created_at,
      };
    }

    // Tạo transaction record trong database (PENDING status)
    const transaction = await Transaction.create({
      order_id: orderId,
      amount: parseFloat(amount),
      currency: "VND",
      type: "CHARGE",
      method: "VNPAY",
      status: "PENDING",
    });

    // Tạo payment URL
    const paymentUrl = vnpayService.createPaymentUrl({
      orderId,
      amount: parseFloat(amount),
      orderInfo,
      orderType: "billpayment",
      ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
      locale: "vn",
      bankCode: "NCB",
    });

    return {
      transactionId: transaction.id,
      orderId,
      amount: transaction.amount,
      orderInfo,
      paymentUrl,
      status: transaction.status,
      createdAt: transaction.created_at,
    };
  }

  async payOrderByWallet({ bookingOrderId, userId, pin, orderInfo, ipAddr }) {
    if (!bookingOrderId || !userId || !pin) {
      const error = new Error("Missing required fields: bookingOrderId, pin");
      error.statusCode = 400;
      throw error;
    }

    const bookingOrder = await BookingOrder.findOne({ id: bookingOrderId });
    if (!bookingOrder) {
      const error = new Error("Không tìm thấy đơn hàng");
      error.statusCode = 404;
      throw error;
    }

    const normalizedUserId = String(userId);
    if (String(bookingOrder.user_id) !== normalizedUserId) {
      const error = new Error("Chỉ người sở hữu đơn hàng mới có thể thanh toán bằng ví");
      error.statusCode = 403;
      throw error;
    }

    if (bookingOrder.status !== "PENDING") {
      const error = new Error(
        `Không thể thanh toán đơn hàng có trạng thái: ${bookingOrder.status}`,
      );
      error.statusCode = 400;
      throw error;
    }

    const orderTotalAmount = this._resolvePayableAmount(bookingOrder);

    const existingPendingVnpay = await Transaction.findOne({
      order_id: bookingOrderId,
      type: "CHARGE",
      method: "VNPAY",
      status: "PENDING",
    }).sort({ created_at: -1 });

    if (existingPendingVnpay) {
      const paymentUrl = vnpayService.createPaymentUrl({
        orderId: bookingOrderId,
        amount: Number(existingPendingVnpay.amount),
        orderInfo: orderInfo || `Thanh toan phan con lai don ${bookingOrderId}`,
        orderType: "billpayment",
        ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
        locale: "vn",
        bankCode: "NCB",
        txnRef: existingPendingVnpay.provider_reference || bookingOrderId,
      });

      return {
        mode: "pending_vnpay",
        orderId: bookingOrderId,
        orderTotalAmount,
        remainingAmount: Number(existingPendingVnpay.amount),
        transactionId: existingPendingVnpay.id,
        paymentUrl,
      };
    }

    await walletService.verifyPaymentPin(normalizedUserId, pin);

    const session = await mongoose.startSession();
    let result;

    try {
      await session.withTransaction(async () => {
        const liveOrder = await BookingOrder.findOne({ id: bookingOrderId }).session(
          session,
        );

        if (!liveOrder) {
          const error = new Error("Không tìm thấy đơn hàng");
          error.statusCode = 404;
          throw error;
        }

        if (liveOrder.status !== "PENDING") {
          const error = new Error(
            `Không thể thanh toán đơn hàng có trạng thái: ${liveOrder.status}`,
          );
          error.statusCode = 400;
          throw error;
        }

        const payableAmount = this._resolvePayableAmount(liveOrder);
        const alreadyCharged = await this._sumSuccessfulCharges(
          bookingOrderId,
          session,
        );
        const remainingBeforeWallet = Math.max(0, payableAmount - alreadyCharged);

        if (remainingBeforeWallet <= 0) {
          const settled = await this._settleOrderIfFullyPaid(bookingOrderId, session);
          result = {
            mode: "completed",
            orderId: bookingOrderId,
            orderTotalAmount: Number(payableAmount),
            paidAmountWallet: Number(settled?.walletCharged || 0),
            paidAmountVnpay: Number(settled?.vnpayCharged || 0),
            remainingAmount: 0,
          };
          return;
        }

        const wallet = await walletService.getOrCreateWalletByUserId(
          normalizedUserId,
          session,
        );
        walletService.ensureWalletActive(wallet);

        const balanceBefore = Number(wallet.balance || 0);
        const walletDebitAmount = Math.min(balanceBefore, remainingBeforeWallet);

        let walletCharge = null;
        if (walletDebitAmount > 0) {
          wallet.balance = Number((balanceBefore - walletDebitAmount).toFixed(2));
          await wallet.save({ session });

          walletCharge = await Transaction.create(
            [
              {
                order_id: bookingOrderId,
                amount: Number(walletDebitAmount.toFixed(2)),
                currency: "VND",
                type: "CHARGE",
                method: "WALLET",
                status: "SUCCESS",
                provider_reference: `WALLET_PAY_${bookingOrderId}_${Date.now()}`,
              },
            ],
            { session },
          );

          await WalletTransaction.create(
            [
              {
                wallet_id: wallet.id,
                amount: Number(walletDebitAmount.toFixed(2)),
                type: "PAYMENT",
                transaction_id: walletCharge[0].id,
                reference_id: bookingOrderId,
                description: `Thanh toan vi cho don ${bookingOrderId}`,
                balance_before: Number(balanceBefore.toFixed(2)),
                balance_after: Number(wallet.balance.toFixed(2)),
              },
            ],
            { session },
          );
        }

        const remainingAmount = Number(
          Math.max(0, remainingBeforeWallet - walletDebitAmount).toFixed(2),
        );

        if (remainingAmount <= 0) {
          const settled = await this._settleOrderIfFullyPaid(bookingOrderId, session);
          result = {
            mode: "completed",
            orderId: bookingOrderId,
            orderTotalAmount: Number(payableAmount),
            paidAmountWallet: Number(settled?.walletCharged || walletDebitAmount || 0),
            paidAmountVnpay: Number(settled?.vnpayCharged || 0),
            remainingAmount: 0,
          };
          return;
        }

        const pendingTxnRef = `${bookingOrderId}_PARTIAL_${Date.now()}`;
        const pendingVnpayTransaction = await Transaction.create(
          [
            {
              order_id: bookingOrderId,
              amount: remainingAmount,
              currency: "VND",
              type: "CHARGE",
              method: "VNPAY",
              status: "PENDING",
              provider_reference: pendingTxnRef,
            },
          ],
          { session },
        );

        liveOrder.payment_method = walletDebitAmount > 0 ? "HYBRID" : "VNPAY";
        await liveOrder.save({ session });

        result = {
          mode: "pending_vnpay",
          orderId: bookingOrderId,
          orderTotalAmount: Number(payableAmount),
          paidAmountWallet: Number(walletDebitAmount.toFixed(2)),
          remainingAmount,
          transactionId: pendingVnpayTransaction[0].id,
          txnRef: pendingTxnRef,
        };
      });
    } finally {
      session.endSession();
    }

    if (result?.mode === "completed") {
      await this._ensureOnlineKeysForOrder(bookingOrderId);

      await notificationService.sendToUser(normalizedUserId, {
        title: "Thanh toán thành công",
        message: `Đơn ${bookingOrderId} đã thanh toán thành công bằng ví.`,
        type: "PAYMENT",
        event_code: "PAYMENT_SUCCESS",
        dedupe_key: `PAYMENT_SUCCESS:WALLET:${bookingOrderId}`,
        data: {
          type: "PAYMENT_SUCCESS",
          order_id: bookingOrderId,
          payment_method: "WALLET",
          amount_wallet: String(result.paidAmountWallet || 0),
          amount_vnpay: String(result.paidAmountVnpay || 0),
        },
      });

      return result;
    }

    const paymentUrl = vnpayService.createPaymentUrl({
      orderId: bookingOrderId,
      amount: Number(result.remainingAmount),
      orderInfo: orderInfo || `Thanh toan phan con lai don ${bookingOrderId}`,
      orderType: "billpayment",
      ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
      locale: "vn",
      bankCode: "NCB",
      txnRef: result.txnRef,
    });

    await notificationService.sendToUser(normalizedUserId, {
      title: "Thanh toán còn thiếu",
      message: `Đơn ${bookingOrderId} cần thanh toán thêm qua VNPay để hoàn tất.`,
      type: "PAYMENT",
      event_code: "PAYMENT_PENDING_REMAINING",
      dedupe_key: `PAYMENT_PENDING_REMAINING:${bookingOrderId}:${result.transactionId}`,
      data: {
        type: "PAYMENT_PENDING_REMAINING",
        order_id: bookingOrderId,
        amount_wallet_paid: String(result.paidAmountWallet || 0),
        amount_remaining: String(result.remainingAmount || 0),
      },
    });

    return {
      ...result,
      paymentUrl,
    };
  }

  async createWalletTopupPayment({ userId, amount, orderInfo, ipAddr }) {
    if (!userId || !amount || !orderInfo) {
      const error = new Error("Missing required fields: amount, orderInfo");
      error.statusCode = 400;
      throw error;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      const error = new Error("amount must be a positive number");
      error.statusCode = 400;
      throw error;
    }

    const MIN_TOPUP_AMOUNT = 10000;
    if (parsedAmount < MIN_TOPUP_AMOUNT) {
      const error = new Error(`Minimum topup amount is ${MIN_TOPUP_AMOUNT} VND`);
      error.statusCode = 400;
      throw error;
    }

    let wallet = await Wallet.findOne({ user_id: String(userId) });
    if (!wallet) {
      wallet = await Wallet.create({
        user_id: String(userId),
        balance: 0,
        status: "ACTIVE",
      });
    }

    if (wallet.status !== "ACTIVE") {
      const error = new Error("Wallet is locked");
      error.statusCode = 423;
      throw error;
    }

    const txnRef = `WALLET_TOPUP_${wallet.id}_${Date.now()}`;
    const paymentUrl = vnpayService.createPaymentUrl({
      orderId: wallet.id,
      amount: parsedAmount,
      orderInfo,
      orderType: "other",
      ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
      locale: "vn",
      bankCode: "NCB",
      txnRef,
    });

    return {
      transactionId: null,
      walletId: wallet.id,
      amount: parsedAmount,
      status: "PENDING",
      paymentUrl,
      txnRef,
    };
  }

  /**
   * Xử lý VNPay return/callback
   */
  async handleVnpayReturn(vnpayParams) {

    const verifyResult = vnpayService.verifyReturnUrl({ ...vnpayParams });
    const isValid = verifyResult && verifyResult.isValid;

    if (!isValid) {
      const error = new Error("Invalid signature");
      error.statusCode = 400;
      throw error;
    }
    const vnp_TxnRef = String(vnpayParams.vnp_TxnRef || "");
    const partialRefMarker = "_PARTIAL_";
    const partialRefIndex = vnp_TxnRef.indexOf(partialRefMarker);
    const originalOrderId =
      partialRefIndex > -1
        ? vnp_TxnRef.slice(0, partialRefIndex)
        : vnp_TxnRef;

    // Extract data
    const orderId = originalOrderId;
    const responseCode = vnpayParams.vnp_ResponseCode;
    const transactionNo = vnpayParams.vnp_TransactionNo;
    const amount = parseInt(vnpayParams.vnp_Amount) / 100; // VNPay trả về số tiền x100
    const bankCode = vnpayParams.vnp_BankCode;
    const payDate = vnpayParams.vnp_PayDate;

    let transaction = await Transaction.findOne({
      provider_reference: vnp_TxnRef,
      type: "CHARGE",
      method: "VNPAY",
    });

    if (!transaction) {
      transaction = await Transaction.findOne({
        order_id: originalOrderId,
        type: "CHARGE",
        method: "VNPAY",
        status: "PENDING",
      }).sort({ created_at: -1 });
    }

    if (!transaction) {
      // Idempotent fallback: callback may arrive again after transaction was already marked SUCCESS/FAILED.
      transaction = await Transaction.findOne({
        order_id: originalOrderId,
        type: "CHARGE",
        method: "VNPAY",
      }).sort({ created_at: -1 });
    }

    if (!transaction) {
      const error = new Error("Transaction not found");
      error.statusCode = 404;
      throw error;
    }

    if (transaction.status !== "PENDING") {
      if (responseCode === "00" && transaction.status === "SUCCESS") {
        const settled = await this._settleOrderIfFullyPaid(originalOrderId);
        if (settled?.isPaid) {
          await this._ensureOnlineKeysForOrder(originalOrderId);
        }
      }

      return {
        code: responseCode,
        message: "Transaction already processed",
        transactionId: transaction.id,
        orderId: transaction.order_id,
        status: transaction.status,
        amount: transaction.amount,
      };
    }

    let newStatus;
    let message;

    if (responseCode === "00") {
      newStatus = "SUCCESS";
      message = "Transaction successful";
    } else {
      newStatus = "FAILED";
      message = "Transaction failed";
    }

    transaction.status = newStatus;
    // Keep provider_reference aligned with vnp_TxnRef for stable lookup across repeated callbacks.
    if (!transaction.provider_reference) {
      transaction.provider_reference = vnp_TxnRef || transaction.provider_reference;
    }
    await transaction.save();

    if (newStatus === "SUCCESS") {
      const settled = await this._settleOrderIfFullyPaid(originalOrderId);
      if (settled?.isPaid) {
        await this._ensureOnlineKeysForOrder(originalOrderId);
      }

      const paidOrder = await BookingOrder.findOne({ id: originalOrderId }).select("id user_id final_total_price payable_total_price payment_method");
      if (paidOrder?.user_id) {
        await notificationService.sendToUser(paidOrder.user_id, {
          title: "Thanh toán thành công",
          message: `Đơn ${paidOrder.id} đã thanh toán thành công.`,
          type: "PAYMENT",
          event_code: "PAYMENT_SUCCESS",
          dedupe_key: `PAYMENT_SUCCESS:${transaction.id}`,
          data: {
            type: "PAYMENT_SUCCESS",
            order_id: paidOrder.id,
            transaction_id: transaction.id,
            transaction_no: transactionNo || "",
            amount: String(paidOrder.payable_total_price || paidOrder.final_total_price || amount || 0),
            payment_method: paidOrder.payment_method || "VNPAY",
          },
        });
      }
    }

    return {
      code: responseCode,
      message,
      transactionId: transaction.id,
      orderId: transaction.order_id,
      transactionNo,
      amount: transaction.amount,
      status: transaction.status,
      bankCode,
      paymentDate: payDate || null,
    };
  }

  async handleWalletTopupVnpayReturn(vnpayParams) {
    const verifyResult = vnpayService.verifyReturnUrl({ ...vnpayParams });
    if (!verifyResult || !verifyResult.isValid) {
      const error = new Error("Invalid signature");
      error.statusCode = 400;
      throw error;
    }

    const txnRef = String(vnpayParams.vnp_TxnRef || "");
    const responseCode = String(vnpayParams.vnp_ResponseCode || "");
    const transactionNo = String(vnpayParams.vnp_TransactionNo || "");
    const paidAmount = Number(vnpayParams.vnp_Amount || 0) / 100;

    if (!txnRef.startsWith("WALLET_TOPUP_")) {
      const error = new Error("Invalid wallet topup transaction reference");
      error.statusCode = 400;
      throw error;
    }

    const txnRefMatch = txnRef.match(/^WALLET_TOPUP_([^_]+)_\d+$/);
    if (!txnRefMatch) {
      const error = new Error("Invalid wallet topup transaction reference");
      error.statusCode = 400;
      throw error;
    }

    const walletIdFromRef = String(txnRefMatch[1] || "").trim();
    if (!walletIdFromRef) {
      const error = new Error("Invalid wallet id in topup transaction reference");
      error.statusCode = 400;
      throw error;
    }

    if (responseCode !== "00") {
      return {
        code: responseCode,
        message: "Topup failed",
        transactionId: null,
        walletId: walletIdFromRef,
        status: "FAILED",
        amount: paidAmount,
        transactionNo,
        txnRef,
      };
    }

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      const error = new Error("Amount mismatch in VNPay callback");
      error.statusCode = 400;
      throw error;
    }

    let walletId = walletIdFromRef;
    let walletUserId = null;
    let balanceBefore = 0;
    let balanceAfter = 0;
    let isNewTopupApplied = false;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const wallet = await Wallet.findOne({ id: walletIdFromRef }).session(session);
        if (!wallet) {
          const error = new Error("Wallet not found for topup transaction");
          error.statusCode = 404;
          throw error;
        }

        if (wallet.status !== "ACTIVE") {
          const error = new Error("Wallet is locked");
          error.statusCode = 423;
          throw error;
        }

        walletId = wallet.id;
        walletUserId = String(wallet.user_id || "");

        const existingWalletTopupAudit = await WalletTransaction.findOne({
          reference_id: txnRef,
          type: "TOPUP",
        }).session(session);

        if (existingWalletTopupAudit) {
          balanceBefore = Number(existingWalletTopupAudit.balance_before || 0);
          balanceAfter = Number(existingWalletTopupAudit.balance_after || 0);
          return;
        }

        balanceBefore = Number(wallet.balance || 0);
        balanceAfter = Number((balanceBefore + Number(paidAmount)).toFixed(2));
        wallet.balance = balanceAfter;
        await wallet.save({ session });

        await WalletTransaction.create(
          [
            {
              wallet_id: wallet.id,
              amount: Number(paidAmount),
              type: "TOPUP",
              transaction_id: null,
              reference_id: txnRef,
              description: `VNPay wallet topup${transactionNo ? ` (${transactionNo})` : ""}`,
              balance_before: balanceBefore,
              balance_after: balanceAfter,
            },
          ],
          { session },
        );

        isNewTopupApplied = true;
      });
    } catch (error) {
      if (error?.code === 11000) {
        const existingWalletTopupAudit = await WalletTransaction.findOne({
          reference_id: txnRef,
          type: "TOPUP",
        });

        if (existingWalletTopupAudit) {
          walletId = existingWalletTopupAudit.wallet_id || walletIdFromRef;
          balanceBefore = Number(existingWalletTopupAudit.balance_before || 0);
          balanceAfter = Number(existingWalletTopupAudit.balance_after || 0);
          const wallet = await Wallet.findOne({ id: walletId }).select("user_id");
          walletUserId = wallet ? String(wallet.user_id || "") : null;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    } finally {
      session.endSession();
    }

    if (isNewTopupApplied && walletUserId) {
      const debtSettlement = await debtService.settleUserDebtFromWallet({
        userId: walletUserId,
        trigger: `TOPUP:${txnRef}`,
      });

      if (Number.isFinite(Number(debtSettlement?.wallet_balance_after))) {
        balanceAfter = Number(debtSettlement.wallet_balance_after);
      }
    }

    return {
      code: responseCode,
      message: "Topup successful",
      transactionId: null,
      walletId,
      amount: Number(paidAmount),
      status: "SUCCESS",
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      transactionNo,
      txnRef,
    };
  }

  /**
   * Query payment status từ VNPay
   */
  async queryPaymentStatus({ orderId, transactionDate }) {
    // Validate input
    if (!orderId || !transactionDate) {
      throw new Error("orderId and transactionDate are required");
    }

    // Validate date format (YYYYMMDD)
    const dateRegex = /^\d{8}$/;
    if (!dateRegex.test(transactionDate)) {
      throw new Error("transactionDate must be in YYYYMMDD format");
    }

    const transaction = await Transaction.findOne({
      order_id: orderId,
      type: "CHARGE",
    }).sort({ created_at: -1 });

    if (!transaction) {
      const error = new Error("Transaction not found in database");
      error.statusCode = 404;
      throw error;
    }

    return {
      localTransaction: {
        transactionId: transaction.id,
        orderId: transaction.order_id,
        amount: transaction.amount,
        status: transaction.status,
        providerReference: transaction.provider_reference,
        createdAt: transaction.created_at,
      },
      vnpayQuery: {
        supported: false,
        message: "VNPay query API is not implemented in this service",
        orderId,
        transactionDate,
      },
    };
  }

  /**
   * Refund payment qua VNPay
   */
  async refundPayment({ orderId, transactionDate, amount, reason, ipAddr }) {
    // Validate input
    if (!orderId || !transactionDate || !amount) {
      throw new Error("orderId, transactionDate, and amount are required");
    }

    // Validate date format
    const dateRegex = /^\d{8}$/;
    if (!dateRegex.test(transactionDate)) {
      throw new Error("transactionDate must be in YYYYMMDD format");
    }

    const transaction = await Transaction.findOne({
      order_id: orderId,
      type: "CHARGE",
    }).sort({ created_at: -1 });

    if (!transaction) {
      const error = new Error("Transaction not found in database");
      error.statusCode = 404;
      throw error;
    }

    if (transaction.status !== "SUCCESS") {
      const error = new Error(
        `Cannot refund transaction with status: ${transaction.status}. Only SUCCESS transactions can be refunded.`,
      );
      error.statusCode = 400;
      throw error;
    }

    if (amount > transaction.amount) {
      throw new Error(
        `Refund amount (${amount}) cannot exceed transaction amount (${transaction.amount})`,
      );
    }

    const refundTransaction = await Transaction.create({
      order_id: orderId,
      amount: parseFloat(amount),
      currency: "VND",
      type: "REFUND",
      method: transaction.method || "VNPAY",
      status: "SUCCESS",
      provider_reference: transaction.provider_reference || null,
    });

    return {
      transaction: {
        transactionId: transaction.id,
        orderId: transaction.order_id,
        amount: transaction.amount,
        status: transaction.status,
      },
      refund: {
        transactionId: refundTransaction.id,
        orderId: refundTransaction.order_id,
        amount: refundTransaction.amount,
        status: refundTransaction.status,
        reason: reason || "Customer request",
        transactionDate,
        ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
      },
    };
  }

  /**
   * Initiate repayment for PENDING order
   * Tạo payment URL mới với vnp_TxnRef và vnp_ExpireDate tính toán lại
   * @param {String} orderId - Booking order ID
   * @param {Object} actor - Authenticated user
   * @param {String} ipAddr - Client IP address
   * @returns {Promise<Object>} Payment URL và transaction info
   */
  async initiateRepayment(orderId, actor, ipAddr) {
    const bookingOrder = await BookingOrder.findOne({ id: orderId });
    if (!bookingOrder) {
      const error = new Error("Booking order not found");
      error.statusCode = 404;
      throw error;
    }

    // Validate user is order owner
    const actorId = String(actor?._id || actor?.id || "");
    const isOwner = actorId && actorId === String(bookingOrder.user_id);
    if (!isOwner) {
      const error = new Error("Only order owner can repay this order");
      error.statusCode = 403;
      throw error;
    }

    // Validate order status
    if (bookingOrder.status !== "PENDING") {
      const error = new Error(
        `Cannot repay order with status: ${bookingOrder.status}`,
      );
      error.statusCode = 400;
      throw error;
    }

    // Calculate remaining time
    const now = new Date();
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const orderDeadline = new Date(
      bookingOrder.createdAt.getTime() + TEN_MINUTES_MS,
    );
    const remainingMs = orderDeadline.getTime() - now.getTime();
    const remainingMinutes = remainingMs / 60000;
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    // GUARD 1: Order fully expired
    if (remainingMinutes <= 0) {
      const error = new Error(
        `Order has expired (deadline was ${orderDeadline.toISOString()})`,
      );
      error.statusCode = 410; // HTTP 410 Gone
      throw error;
    }

    // GUARD 2: Order too close to expiration (less than 1 minute remaining)
    if (remainingMinutes < 1) {
      const error = new Error(
        `Order is expiring soon (${remainingSeconds} seconds remaining). ` +
        `Please proceed immediately or create a new order.`,
      );
      error.statusCode = 400;
      throw error;
    }

    // Get all CHARGE transactions to calculate attemptNumber
    const allChargeTransactions = await Transaction.find({
      order_id: orderId,
      type: "CHARGE",
    }).sort({ createdAt: -1 });

    // Calculate attemptNumber: số lượng attempts đã có + 1
    // Cách này đơn giản: 0 transactions → attempt 1, 1 transaction → attempt 2, etc.
    const attemptNumber = allChargeTransactions.length + 1;

    // Create new transaction reference
    const newTxnRef = `${orderId}_${attemptNumber}`;

    // Calculate vnp_ExpireDate: min(4 minutes, remainingTime - 1 minute)
    const fourMinutesMs = 4 * 60 * 1000;
    const oneMinuteMs = 1 * 60 * 1000;
    const safeRemainingMs = remainingMs - oneMinuteMs; // Leave 1 minute buffer
    const paymentExpireMs = Math.min(fourMinutesMs, safeRemainingMs);
    const vnpExpireDate = new Date(now.getTime() + paymentExpireMs);

    const payableAmount =
      bookingOrder.payable_total_price || bookingOrder.final_total_price;

    // Create new Payment URL with custom parameters
    const paymentUrl = vnpayService.createPaymentUrl({
      orderId,
      amount: payableAmount,
      orderInfo: `Repay Order #${orderId} - Attempt ${attemptNumber}`,
      orderType: "billpayment",
      ipAddr: (ipAddr || "127.0.0.1").replace("::ffff:", ""),
      locale: "vn",
      bankCode: "NCB",
      txnRef: newTxnRef, // ← Custom transaction reference
      expireDate: vnpExpireDate, // ← Custom expire date
    });

    // Create new Transaction record (PENDING status)
    const transaction = await Transaction.create({
      order_id: orderId,
      amount: payableAmount,
      currency: "VND",
      type: "CHARGE",
      method: "VNPAY",
      status: "PENDING",
      provider_reference: newTxnRef,
    });

    console.log("Repayment initiated:", {
      transactionId: transaction.id,
      orderId,
      attemptNumber,
      txnRef: newTxnRef,
      amount: payableAmount,
      orderExpireAt: orderDeadline.toISOString(),
      paymentExpireAt: vnpExpireDate.toISOString(),
      remainingSeconds,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      transactionId: transaction.id,
      orderId,
      amount: transaction.amount,
      paymentUrl,
      attemptNumber,
      orderExpireAt: orderDeadline,
      paymentExpireAt: vnpExpireDate,
      remainingSeconds,
      message: `Repayment link created (Attempt #${attemptNumber})`,
    };
  }

  /**
   * Lấy payment theo orderId
   */
  async getPaymentByOrderId(orderId) {
    const transaction = await Transaction.findOne({
      order_id: orderId,
      type: "CHARGE",
    }).sort({ created_at: -1 });

    if (!transaction) {
      const error = new Error("Transaction not found");
      error.statusCode = 404;
      throw error;
    }

    return transaction;
  }

  /**
   * Lấy payment theo paymentId
   */
  async getPaymentByPaymentId(paymentId) {
    const transaction = await Transaction.findOne({ id: paymentId });

    if (!transaction) {
      const error = new Error("Transaction not found");
      error.statusCode = 404;
      throw error;
    }

    return transaction;
  }

  /**
   * Lấy tất cả payments với filters
   */
  async getAllPayments({ status, method, bookingId, startDate, endDate }) {
    const filter = {};

    if (status) filter.status = status;
    if (method) filter.method = method;
    if (bookingId) filter.order_id = bookingId;

    if (startDate || endDate) {
      filter.created_at = {};
      if (startDate) filter.created_at.$gte = new Date(startDate);
      if (endDate) filter.created_at.$lte = new Date(endDate);
    }

    const payments = await Transaction.find(filter).sort({ created_at: -1 });

    return payments;
  }

  /**
   * Lấy tất cả transactions của user hiện tại
   * @param {String} userId - User ID từ token
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} Danh sách transactions và metadata phân trang
   */
  async getMyTransactions(userId, options = {}) {
    if (!userId) {
      const error = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }

    const page = Math.max(parseInt(options.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const bookingOrders = await BookingOrder.find({ user_id: String(userId) })
      .select("id")
      .lean();

    const orderIds = bookingOrders.map((order) => order.id);

    if (orderIds.length === 0) {
      return {
        transactions: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const filter = {
      order_id: { $in: orderIds },
    };

    const effectiveStartDate = options.startDate || null;
    const effectiveEndDate = options.endDate || null;

    if (effectiveStartDate || effectiveEndDate) {
      filter.created_at = {};

      if (effectiveStartDate) {
        filter.created_at.$gte = this._parseDateOrThrow(effectiveStartDate, "startDate");
      }

      if (effectiveEndDate) {
        filter.created_at.$lte = this._parseDateOrThrow(effectiveEndDate, "endDate");
      }
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy tất cả transactions (admin/internal)
   * @param {Object} options - Filters và pagination
   * @returns {Promise<Object>} Danh sách transactions và metadata phân trang
   */
  async getAllTransactions(options = {}) {
    const { status, method, type, orderId, startDate, endDate, page, limit } =
      options;

    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (currentPage - 1) * pageSize;

    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (type) filter.type = type;
    if (orderId) filter.order_id = orderId;

    if (startDate || endDate) {
      filter.created_at = {};
      if (startDate) filter.created_at.$gte = new Date(startDate);
      if (endDate) filter.created_at.$lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize),
      Transaction.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}

module.exports = new PaymentService();
