const BookingOrder = require("../models/BookingOrder");
const Booking = require("../models/Bookings");
const BookingAccessSession = require("../models/BookingAccessSession");
const PodCluster = require("../models/PodCluster");
const Pod = require("../models/Pod");
const User = require("../models/User");
const TimeSlot = require("../models/TimeSlot");
const BookingSlot = require("../models/BookingSlot");
const BookingVoucher = require("../models/BookingVoucher");
const BookingPricingDetail = require("../models/BookingPricingDetail");
const Voucher = require("../models/Voucher");
const Location = require("../models/Location");
const PricingRule = require("../models/PricingRule");
const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const { autoAssignTaskForBooking } = require("./cleaningTaskService");
const reviewService = require("./reviewService");
const notificationService = require("./notificationService");
const depositPolicyService = require("./depositPolicyService");

// Slot configuration
const DEFAULT_SLOT_DURATION_MINUTES = 30;
const HOLD_EXPIRATION_MINUTES = 10;
const MINIMUM_DURATION_MINUTES = 60; // Minimum booking: 1 hour
const PRICE_UNIT_MULTIPLIER = 10000;
const REFUND_CANCEL_WINDOW_HOURS = 48;
const REFUND_RATE_BEFORE_48H = 1;

class BookingOrderService {
    _roundMoney(value) {
        return Number((Number(value || 0)).toFixed(2));
    }

    _createError(message, statusCode) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    _normalizeVoucherCode(code) {
        return String(code || "").trim().toUpperCase();
    }

    _calculateVoucherDiscountAmount(order, voucher) {
        const totalBasePrice = Number(order?.total_base_price || 0);
        const discountType = String(voucher?.discount_type || "").toUpperCase();
        const discountValue = Number(voucher?.discount_value || 0);

        let discountAmount = 0;
        if (discountType === "FIXED") {
            discountAmount = discountValue;
        } else if (discountType === "PERCENT") {
            discountAmount = totalBasePrice * (discountValue / 100);
            if (voucher.max_discount !== null && voucher.max_discount !== undefined) {
                discountAmount = Math.min(discountAmount, Number(voucher.max_discount || 0));
            }
        }

        if (!Number.isFinite(discountAmount) || discountAmount < 0) {
            discountAmount = 0;
        }

        return Math.min(discountAmount, totalBasePrice);
    }

    _assertVoucherEligibility(order, voucher, now = new Date()) {
        if (!voucher) {
            throw this._createError("Voucher not found", 404);
        }

        if (!voucher.is_active) {
            throw this._createError("Voucher is inactive", 400);
        }

        if (voucher.valid_from && now < new Date(voucher.valid_from)) {
            throw this._createError("Voucher is not active yet", 400);
        }

        if (voucher.valid_to && now > new Date(voucher.valid_to)) {
            throw this._createError("Voucher has expired", 400);
        }

        if (voucher.usage_limit !== null && voucher.usage_limit !== undefined) {
            if (Number(voucher.usage_count || 0) >= Number(voucher.usage_limit || 0)) {
                throw this._createError("Voucher usage limit has been reached", 400);
            }
        }

        const minBookingValue = Number(voucher.min_booking_value || 0);
        if (Number(order.total_base_price || 0) < minBookingValue) {
            throw this._createError(
                `Order does not meet minimum booking value ${minBookingValue}`,
                400
            );
        }
    }

    async _calculateVolumeBasedDeposit(podCount = 0) {
        const pricingPolicy = await depositPolicyService.getPolicyForCalculation();
        const tier1Limit = Number(pricingPolicy.tier_1_pod_limit || 3);
        const tier2Limit = Number(pricingPolicy.tier_2_pod_limit || 6);
        const tier1Price = Number(pricingPolicy.tier_1_price || 0);
        const tier2Price = Number(pricingPolicy.tier_2_price || 0);
        const tier3Price = Number(pricingPolicy.tier_3_price || 0);

        const normalizedPodCount = Math.max(0, parseInt(podCount, 10) || 0);
        const tier1Pods = Math.min(normalizedPodCount, tier1Limit);
        const tier2Pods = Math.min(Math.max(normalizedPodCount - tier1Limit, 0), tier2Limit - tier1Limit);
        const tier3Pods = Math.max(normalizedPodCount - tier2Limit, 0);

        const tier1Amount = tier1Pods * tier1Price;
        const tier2Amount = tier2Pods * tier2Price;
        const tier3Amount = tier3Pods * tier3Price;

        const depositTotal = tier1Amount + tier2Amount + tier3Amount;
        const depositOriginalTotal = normalizedPodCount * tier1Price;
        const depositDiscount = Math.max(0, depositOriginalTotal - depositTotal);

        return {
            pod_count: normalizedPodCount,
            deposit_original_total: depositOriginalTotal,
            deposit_discount: depositDiscount,
            deposit_total: depositTotal,
            tiers: {
                tier_1: {
                    pod_count: tier1Pods,
                    amount_per_pod: tier1Price,
                    amount: tier1Amount,
                },
                tier_2: {
                    pod_count: tier2Pods,
                    amount_per_pod: tier2Price,
                    amount: tier2Amount,
                },
                tier_3: {
                    pod_count: tier3Pods,
                    amount_per_pod: tier3Price,
                    amount: tier3Amount,
                },
            },
            policy: {
                pricing_model: "VOLUME_BASED_DEPOSIT",
                tier_1_pod_limit: tier1Limit,
                tier_2_pod_limit: tier2Limit,
                tier_1_price: tier1Price,
                tier_2_price: tier2Price,
                tier_3_price: tier3Price,
                pricing_source: pricingPolicy.source || "DEFAULT",
                partial_cancel_behavior: "KEEP_DEPOSIT_UNCHANGED",
                settlement_behavior: "PENDING_INSPECTION",
            },
        };
    }

    _normalizeIdList(input) {
        if (!input) return [];

        if (Array.isArray(input)) {
            return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
        }

        return [...new Set(String(input).split(",").map((item) => item.trim()).filter(Boolean))];
    }

    async _findOrderIdsByPodIds(podIds) {
        const normalizedPodIds = this._normalizeIdList(podIds);
        if (normalizedPodIds.length === 0) {
            return [];
        }

        const bookings = await Booking.find({ pod_id: { $in: normalizedPodIds } })
            .select("order_id")
            .lean();

        return [...new Set(bookings.map((booking) => String(booking.order_id)).filter(Boolean))];
    }

    async _isOrderInManagerScope(orderId, managerScope = null) {
        const scopedPodIds = this._normalizeIdList(managerScope?.podIds);
        if (scopedPodIds.length === 0) return false;

        const scopedBooking = await Booking.findOne({
            order_id: orderId,
            pod_id: { $in: scopedPodIds },
        })
            .select("id")
            .lean();

        return !!scopedBooking;
    }

    async _releaseBookingResources(bookingIds, session = null) {
        if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
            return;
        }

        const bookingSlots = await BookingSlot.find({ booking_id: { $in: bookingIds } }).session(session);
        const timeSlotIds = bookingSlots.map((bookingSlot) => bookingSlot.time_slot_id);

        if (timeSlotIds.length > 0) {
            await TimeSlot.deleteMany({ id: { $in: timeSlotIds } }).session(session);
        }

        await BookingSlot.deleteMany({ booking_id: { $in: bookingIds } }).session(session);
    }

    async _resolveBookingAmounts(bookings = [], session = null) {
        if (!Array.isArray(bookings) || bookings.length === 0) {
            return {
                total_amount: 0,
                amount_source: {
                    pricing_detail_count: 0,
                    booking_fallback_count: 0,
                },
                booking_amounts: [],
            };
        }

        const bookingIds = bookings.map((booking) => String(booking.id)).filter(Boolean);
        const pricingDetails = await BookingPricingDetail.find({
            booking_id: { $in: bookingIds },
        })
            .select("booking_id pricing_rule_id applied_modifier calculated_amount")
            .session(session)
            .lean();

        const detailMap = pricingDetails.reduce((map, detail) => {
            map[String(detail.booking_id)] = detail;
            return map;
        }, {});

        let pricingDetailCount = 0;
        let bookingFallbackCount = 0;

        const bookingAmounts = bookings.map((booking) => {
            const detail = detailMap[String(booking.id)] || null;
            const hasDetailAmount = Number.isFinite(Number(detail?.calculated_amount));
            const resolvedAmount = hasDetailAmount
                ? Number(detail.calculated_amount)
                : Number(booking.total_price || 0);

            if (hasDetailAmount) {
                pricingDetailCount += 1;
            } else {
                bookingFallbackCount += 1;
            }

            return {
                booking_id: booking.id,
                amount: Number(resolvedAmount.toFixed(2)),
                source: hasDetailAmount ? "BOOKING_PRICING_DETAIL" : "BOOKING_TOTAL_PRICE_FALLBACK",
                pricing_rule_id: detail?.pricing_rule_id || null,
                applied_modifier: hasDetailAmount ? Number(detail?.applied_modifier || 1) : null,
            };
        });

        const totalAmount = bookingAmounts.reduce((sum, item) => sum + Number(item.amount || 0), 0);

        return {
            total_amount: Number(totalAmount.toFixed(2)),
            amount_source: {
                pricing_detail_count: pricingDetailCount,
                booking_fallback_count: bookingFallbackCount,
            },
            booking_amounts: bookingAmounts,
        };
    }

    async _calculateRefundForBookings(bookings = [], requestedAt = new Date(), session = null) {
        const requestedAtMs = new Date(requestedAt).getTime();
        const thresholdMs = REFUND_CANCEL_WINDOW_HOURS * 60 * 60 * 1000;

        const eligibleBookings = bookings.filter((booking) => {
            const startMs = new Date(booking.start_time).getTime();
            return Number.isFinite(startMs) && startMs - requestedAtMs >= thresholdMs;
        });

        const amountResolution = await this._resolveBookingAmounts(eligibleBookings, session);
        const refundableBaseAmount = Number(amountResolution.total_amount || 0);

        const refundAmount = Number((refundableBaseAmount * REFUND_RATE_BEFORE_48H).toFixed(2));

        return {
            eligibleBookings,
            refundableBaseAmount: Number(refundableBaseAmount.toFixed(2)),
            refundRate: REFUND_RATE_BEFORE_48H,
            refundAmount,
            amount_source: amountResolution.amount_source,
            booking_amounts: amountResolution.booking_amounts,
            policy: `Refund 100% when cancelled at least ${REFUND_CANCEL_WINDOW_HOURS} hours before check-in`,
        };
    }

    async _recalculateOrderPricingAfterPartialCancel(order, session = null) {
        const remainingBooked = await Booking.find({
            order_id: order.id,
            status: "BOOKED",
        })
            .select("id total_price")
            .session(session);

        const amountResolution = await this._resolveBookingAmounts(remainingBooked, session);
        const recalculatedBase = Number(amountResolution.total_amount || 0);

        let recalculatedDiscount = 0;
        let voucherAction = "NONE";

        const existingBookingVoucher = await BookingVoucher.findOne({ order_id: order.id })
            .session(session)
            .select("id voucher_id");

        if (existingBookingVoucher?.voucher_id) {
            const voucher = await Voucher.findOne({ id: existingBookingVoucher.voucher_id })
                .session(session)
                .select("id discount_type discount_value max_discount min_booking_value");

            const minBookingValue = Number(voucher?.min_booking_value || 0);
            const stillEligibleByMinValue = voucher && recalculatedBase >= minBookingValue;

            if (stillEligibleByMinValue) {
                recalculatedDiscount = this._calculateVoucherDiscountAmount(
                    { total_base_price: recalculatedBase },
                    voucher
                );

                await BookingVoucher.updateOne(
                    { id: existingBookingVoucher.id },
                    { $set: { discount_amount: recalculatedDiscount } }
                ).session(session);
                voucherAction = "RECALCULATED";
            } else {
                await BookingVoucher.deleteOne({ id: existingBookingVoucher.id }).session(session);
                voucherAction = "REMOVED_MIN_BOOKING_VALUE_NOT_MET";
            }
        }

        const finalTotalPrice = Math.max(0, recalculatedBase - recalculatedDiscount);
        const payableTotalPrice = Number(finalTotalPrice) + Number(order.deposit_total || 0);

        order.total_base_price = Number(recalculatedBase.toFixed(2));
        order.total_discount = Number(recalculatedDiscount.toFixed(2));
        order.final_total_price = Number(finalTotalPrice.toFixed(2));
        order.payable_total_price = Number(payableTotalPrice.toFixed(2));

        await order.save({ session });

        return {
            remaining_booking_count: remainingBooked.length,
            total_base_price: order.total_base_price,
            total_discount: order.total_discount,
            final_total_price: order.final_total_price,
            payable_total_price: order.payable_total_price,
            deposit_total_unchanged: Number(order.deposit_total || 0),
            voucher_action: voucherAction,
            amount_source: amountResolution.amount_source,
        };
    }

    async _getOrCreateWalletByUserId(userId, session = null) {
        let wallet = await Wallet.findOne({ user_id: userId }).session(session);
        if (!wallet) {
            const createdWallets = await Wallet.create([
                {
                    user_id: userId,
                    balance: 0,
                    status: "ACTIVE",
                },
            ], { session });
            wallet = createdWallets[0];
        }
        return wallet;
    }

    async _creditWalletWithRefund({
        session,
        userId,
        orderId,
        rentalRefundAmount = 0,
        depositRefundAmount = 0,
        cancelledBookingIds = [],
        isFullCancel = false,
        transactionId = null,
    }) {
        const rentalAmount = Number(rentalRefundAmount || 0);
        const depositAmount = Number(depositRefundAmount || 0);
        const totalAmount = Number((rentalAmount + depositAmount).toFixed(2));

        if (totalAmount <= 0) {
            return {
                wallet: null,
                walletTransactions: [],
                totalRefundAmount: 0,
            };
        }

        const wallet = await this._getOrCreateWalletByUserId(userId, session);
        const walletBalanceBefore = Number(wallet.balance || 0);
        const walletBalanceAfter = Number((walletBalanceBefore + totalAmount).toFixed(2));

        wallet.balance = walletBalanceAfter;
        await wallet.save({ session });

        const walletTransactionsToCreate = [];
        let runningBefore = walletBalanceBefore;

        if (rentalAmount > 0) {
            const runningAfter = Number((runningBefore + rentalAmount).toFixed(2));
            const bookingLabel = cancelledBookingIds.length > 0 ? cancelledBookingIds.join(", ") : "N/A";
            walletTransactionsToCreate.push({
                wallet_id: wallet.id,
                amount: rentalAmount,
                type: "REFUND",
                transaction_id: transactionId,
                reference_id: orderId,
                description: isFullCancel
                    ? `Refund tien thue don ${orderId} cho bookings [${bookingLabel}]`
                    : `Refund tien thue Pod [${bookingLabel}] - Coc giu lai quyet toan sau`,
                balance_before: runningBefore,
                balance_after: runningAfter,
            });
            runningBefore = runningAfter;
        }

        if (depositAmount > 0) {
            const runningAfter = Number((runningBefore + depositAmount).toFixed(2));
            walletTransactionsToCreate.push({
                wallet_id: wallet.id,
                amount: depositAmount,
                type: "REFUND",
                transaction_id: transactionId,
                reference_id: orderId,
                description: `Hoan 100% tien coc don ${orderId} khi huy toan bo`,
                balance_before: runningBefore,
                balance_after: runningAfter,
            });
            runningBefore = runningAfter;
        }

        let createdWalletTransactions = [];
        if (walletTransactionsToCreate.length > 0) {
            createdWalletTransactions = await WalletTransaction.create(walletTransactionsToCreate, {
                session,
                ordered: true,
            });
        }

        return {
            wallet,
            walletTransactions: createdWalletTransactions,
            totalRefundAmount: totalAmount,
            balanceBefore: walletBalanceBefore,
            balanceAfter: walletBalanceAfter,
        };
    }

    async _notifyCancellationAndRefund({
        userId,
        orderId,
        cancellationType,
        cancelledBookingIds = [],
        refund = {},
    }) {
        const normalizedUserId = String(userId || "").trim();
        if (!normalizedUserId) return;

        const normalizedOrderId = String(orderId || "").trim();
        const cancellationKind = cancellationType === "FULL_CANCEL" ? "toan bo" : "mot phan";
        const bookingCount = Array.isArray(cancelledBookingIds) ? cancelledBookingIds.length : 0;

        await notificationService.sendToUser(normalizedUserId, {
            title: "Huy dat cho thanh cong",
            message: `Ban da huy ${cancellationKind} don ${normalizedOrderId} (${bookingCount} pod).`,
            type: "BOOKING",
            event_code: "BOOKING_CANCELLED",
            dedupe_key: `BOOKING_CANCELLED:${normalizedOrderId}:${cancellationType}:${cancelledBookingIds.join(",")}`,
            data: {
                type: "BOOKING_CANCELLED",
                order_id: normalizedOrderId,
                cancellation_type: cancellationType,
                cancelled_booking_ids: cancelledBookingIds,
                cancelled_booking_count: String(bookingCount),
            },
        });

        if (Number(refund?.amount || 0) <= 0) return;

        await notificationService.sendToUser(normalizedUserId, {
            title: "Hoan tien thanh cong",
            message: `He thong da hoan ${Number(refund.amount || 0).toLocaleString("vi-VN")} VND vao vi cua ban.`,
            type: "PAYMENT",
            event_code: "PAYMENT_REFUND_SUCCESS",
            dedupe_key: `PAYMENT_REFUND_SUCCESS:${normalizedOrderId}:${refund?.refunded_transaction_id || "NO_TX"}`,
            data: {
                type: "PAYMENT_REFUND_SUCCESS",
                order_id: normalizedOrderId,
                refund_amount: String(refund.amount || 0),
                rental_amount: String(refund.rental_amount || 0),
                deposit_amount: String(refund.deposit_amount || 0),
                refunded_transaction_id: String(refund.refunded_transaction_id || ""),
                refunded_to_wallet_immediately: String(!!refund.refunded_to_wallet_immediately),
            },
        });
    }

    /**
     * Create a new booking order with multiple pod bookings
     * Uses Mongoose Transaction to ensure data consistency
     * @param {Object} orderData - Order data
     * @returns {Promise<Object>} Created order with bookings
     */
    async createBookingOrder(orderData) {
        const {
            user_id,
            cluster_id,
            start_time,
            end_time,
            total_discount = 0,
            voucher_code = null,
            pod_count = 1,
            require_adjacent = false,
            floor_preference = null,
            accept_fragmented = false,
            accept_mixed_floor = false
        } = orderData;

        // Start a session for transaction
        const session = await mongoose.startSession();

        try {
            // Start transaction
            const txResult = await session.withTransaction(async () => {
                // Validate required fields
                if (!user_id || !cluster_id || !start_time || !end_time) {
                    const error = new Error("Missing required fields: user_id, cluster_id, start_time, end_time");
                    error.statusCode = 400;
                    throw error;
                }

                // Validate user exists
                const user = await User.findOne({ _id: user_id });
                if (!user) {
                    const error = new Error("User not found");
                    error.statusCode = 404;
                    throw error;
                }

                // Validate cluster exists
                const cluster = await PodCluster.findOne({ id: cluster_id });
                if (!cluster) {
                    const error = new Error("Pod cluster not found");
                    error.statusCode = 404;
                    throw error;
                }

                // Get location details
                const location = await Location.findOne({ id: cluster.location_id });
                if (!location) {
                    const error = new Error("Location not found for this cluster");
                    error.statusCode = 404;
                    throw error;
                }

                // Validate time range
                const startDate = new Date(start_time);
                const endDate = new Date(end_time);

                if (endDate <= startDate) {
                    const error = new Error("End time must be after start time");
                    error.statusCode = 400;
                    throw error;
                }

                // Check if start time is in the future
                const now = new Date();
                if (startDate < now) {
                    const error = new Error("Start time must be in the future");
                    error.statusCode = 400;
                    throw error;
                }

                // Get all standard pods in cluster
                const allPods = await Pod.find({
                    cluster_id,
                    status: { $nin: ['MAINTENANCE'] },
                    type: "STANDARD"
                }).lean();

                if (allPods.length === 0) {
                    const error = new Error("No available pods in this cluster");
                    error.statusCode = 404;
                    throw error;
                }

                // Find available pods for the time range
                const availablePods = await this._findAvailablePods(
                    allPods,
                    startDate,
                    endDate
                );

                // Select pods to book based on preferences
                const podsToBook = this._selectPodsForBooking(
                    availablePods,
                    pod_count,
                    require_adjacent,
                    floor_preference,
                    accept_fragmented,
                    accept_mixed_floor
                );

                // Calculate duration in minutes
                const durationMs = endDate - startDate;
                const durationMinutes = Math.ceil(durationMs / (1000 * 60));
                const durationHours = durationMinutes / 60;
                const slotDurationMinutes = cluster.slot_duration_minutes || DEFAULT_SLOT_DURATION_MINUTES;

                // Validate minimum booking duration (1 hour)
                if (durationMinutes < MINIMUM_DURATION_MINUTES) {
                    const error = new Error(`Minimum booking duration is ${MINIMUM_DURATION_MINUTES} minutes (1 hour)`);
                    error.statusCode = 400;
                    throw error;
                }

                // Enforce booking duration to align with configured slot size of this cluster
                if (durationMinutes % slotDurationMinutes !== 0) {
                    const error = new Error(
                        `Booking duration must be a multiple of ${slotDurationMinutes} minutes for this pod cluster`
                    );
                    error.statusCode = 400;
                    throw error;
                }

                // Calculate pricing
                // Formula:
                // total = (base_price_modifier * 10000) * number_of_slots * pod_count
                const basePriceModifier = cluster.base_price_modifier || 0;
                const pricePerSlot = basePriceModifier * PRICE_UNIT_MULTIPLIER;
                const numberOfSlots = durationMinutes / slotDurationMinutes;

                const pricePerPod = this._roundMoney(pricePerSlot * numberOfSlots);
                const selectedPodCount = podsToBook.length;

                // Lock pricing by evaluating rules at booking start time (UTC).
                const ruleEvaluationTime = startDate;
                const [locationRules, podRules] = await Promise.all([
                    PricingRule.find({ location_id: location.id, is_active: true })
                        .sort({ createdAt: -1 })
                        .session(session),
                    PricingRule.find({
                        pod_id: { $in: podsToBook.map((pod) => pod.id) },
                        is_active: true,
                    })
                        .sort({ createdAt: -1 })
                        .session(session),
                ]);

                const matchedLocationRules = locationRules.filter((rule) => rule.matchesUtcDate(ruleEvaluationTime));
                const effectiveLocationRule = matchedLocationRules[0] || null;

                const podRuleMap = podRules.reduce((map, rule) => {
                    const podId = String(rule.pod_id || "");
                    if (!podId) return map;
                    if (!map[podId]) map[podId] = [];
                    map[podId].push(rule);
                    return map;
                }, {});

                const lockedPricingByPod = {};
                for (const pod of podsToBook) {
                    const podId = String(pod.id);
                    const matchedPodRules = (podRuleMap[podId] || []).filter((rule) =>
                        rule.matchesUtcDate(ruleEvaluationTime)
                    );

                    const effectiveRule = matchedPodRules[0] || effectiveLocationRule || null;
                    const appliedModifier = Number(effectiveRule?.multiplier ?? 1);
                    const calculatedAmount = this._roundMoney(pricePerPod * appliedModifier);

                    lockedPricingByPod[podId] = {
                        booking_id: null,
                        pricing_rule_id: effectiveRule?.id || null,
                        applied_modifier: appliedModifier,
                        calculated_amount: calculatedAmount,
                    };
                }

                const totalBasePrice = this._roundMoney(
                    Object.values(lockedPricingByPod).reduce(
                        (sum, item) => sum + Number(item.calculated_amount || 0),
                        0
                    )
                );

                // Apply discount
                let appliedVoucher = null;
                let discountAmount = Number(total_discount || 0);

                const normalizedVoucherCode = this._normalizeVoucherCode(voucher_code);
                if (normalizedVoucherCode) {
                    const voucher = await Voucher.findOne({ code: normalizedVoucherCode }).session(session);
                    this._assertVoucherEligibility({ total_base_price: totalBasePrice }, voucher);

                    discountAmount = this._calculateVoucherDiscountAmount(
                        { total_base_price: totalBasePrice },
                        voucher
                    );

                    appliedVoucher = {
                        id: voucher.id,
                        code: voucher.code,
                        discount_type: voucher.discount_type,
                        discount_value: voucher.discount_value,
                        max_discount: voucher.max_discount,
                        discount_amount: discountAmount,
                    };
                }

                if (!Number.isFinite(discountAmount) || discountAmount < 0) {
                    discountAmount = 0;
                }

                discountAmount = Math.min(discountAmount, totalBasePrice);
                const finalTotalPrice = this._roundMoney(Math.max(0, totalBasePrice - discountAmount));
                const depositPricing = await this._calculateVolumeBasedDeposit(selectedPodCount);
                const payableTotalPrice = this._roundMoney(finalTotalPrice + depositPricing.deposit_total);

                // Create booking order within transaction
                const bookingOrderArray = await BookingOrder.create([{
                    user_id,
                    total_base_price: totalBasePrice,
                    total_discount: discountAmount,
                    final_total_price: finalTotalPrice,
                    deposit_original_total: depositPricing.deposit_original_total,
                    deposit_discount: depositPricing.deposit_discount,
                    deposit_total: depositPricing.deposit_total,
                    payable_total_price: payableTotalPrice,
                    deposit_settlement_status: "PENDING_INSPECTION",
                    status: 'PENDING'
                }], { session });

                const bookingOrder = bookingOrderArray[0];

                if (appliedVoucher) {
                    await BookingVoucher.create([
                        {
                            order_id: bookingOrder.id,
                            voucher_id: appliedVoucher.id,
                            discount_amount: appliedVoucher.discount_amount,
                            applied_at: new Date(),
                        },
                    ], { session, ordered: true });
                }

                // Create individual bookings for each pod within transaction
                const bookings = [];
                const bookingDocs = [];

                for (const pod of podsToBook) {
                    const locked = lockedPricingByPod[String(pod.id)];
                    const bookingPrice = this._roundMoney(locked?.calculated_amount ?? pricePerPod);
                    bookingDocs.push({
                        order_id: bookingOrder.id,
                        user_id,
                        pod_id: pod.id,
                        start_time: startDate,
                        end_time: endDate,
                        base_price: bookingPrice,
                        total_price: bookingPrice,
                        status: 'BOOKED'
                    });
                }

                // Batch create all bookings within transaction
                const createdBookings = await Booking.create(bookingDocs, { session, ordered: true });
                bookings.push(...createdBookings);

                // Persist locked pricing detail for each booking in the same transaction.
                const pricingDetailDocs = createdBookings.map((booking) => {
                    const locked = lockedPricingByPod[String(booking.pod_id)] || {};
                    return {
                        booking_id: booking.id,
                        pricing_rule_id: locked.pricing_rule_id || null,
                        applied_modifier: Number(locked.applied_modifier ?? 1),
                        calculated_amount: this._roundMoney(locked.calculated_amount ?? booking.total_price),
                    };
                });

                const createdPricingDetails = await BookingPricingDetail.create(pricingDetailDocs, {
                    session,
                    ordered: true,
                });

                // Generate time slots and booking slots for each booking
                const allTimeSlotIds = [];
                for (const booking of createdBookings) {
                    // Generate slots based on cluster slot configuration
                    const timeSlotDocs = this._generateTimeSlots(
                        booking.pod_id,
                        new Date(booking.start_time),
                        new Date(booking.end_time),
                        slotDurationMinutes
                    );

                    // Create time slots within transaction
                    const createdTimeSlots = await TimeSlot.create(timeSlotDocs, { session, ordered: true });

                    // Create booking slots linking booking to time slots
                    const bookingSlotDocs = createdTimeSlots.map(ts => ({
                        booking_id: booking.id,
                        time_slot_id: ts.id
                    }));

                    await BookingSlot.create(bookingSlotDocs, { session, ordered: true });

                    // Collect time slot IDs for response
                    allTimeSlotIds.push(...createdTimeSlots.map(ts => ts.id));
                }

                // Schedule expiration check for PENDING order (3 minutes)
                this._scheduleOrderExpiration(bookingOrder.id, HOLD_EXPIRATION_MINUTES);

                // Return order with bookings
                return {
                    order: {
                        id: bookingOrder.id,
                        user_id: bookingOrder.user_id,
                        total_base_price: bookingOrder.total_base_price,
                        total_discount: bookingOrder.total_discount,
                        final_total_price: bookingOrder.final_total_price,
                        deposit_original_total: bookingOrder.deposit_original_total,
                        deposit_discount: bookingOrder.deposit_discount,
                        deposit_total: bookingOrder.deposit_total,
                        payable_total_price: bookingOrder.payable_total_price,
                        deposit_settlement_status: bookingOrder.deposit_settlement_status,
                        status: bookingOrder.status,
                        created_at: bookingOrder.createdAt,
                    },
                    bookings: bookings.map(b => ({
                        id: b.id,
                        pod_id: b.pod_id,
                        start_time: b.start_time,
                        end_time: b.end_time,
                        base_price: b.base_price,
                        total_price: b.total_price,
                        status: b.status,
                    })),
                    booking_pricing_details: createdPricingDetails.map((detail) => ({
                        id: detail.id,
                        booking_id: detail.booking_id,
                        pricing_rule_id: detail.pricing_rule_id,
                        applied_modifier: detail.applied_modifier,
                        calculated_amount: detail.calculated_amount,
                    })),
                    summary: {
                        cluster_id,
                        cluster_name: cluster.name,
                        location_id: location.id,
                        location_name: location.name,
                        start_time: startDate,
                        end_time: endDate,
                        duration_minutes: durationMinutes,
                        duration_hours: durationHours,
                        slot_duration_minutes: slotDurationMinutes,
                        number_of_slots: numberOfSlots,
                        pods_booked: selectedPodCount,
                        pricing_locked_at_utc: ruleEvaluationTime.toISOString(),
                        base_price_modifier: basePriceModifier,
                        price_unit_multiplier: PRICE_UNIT_MULTIPLIER,
                        price_per_slot: pricePerSlot,
                        price_per_pod: pricePerPod,
                        total_base_price: totalBasePrice,
                        total_discount: discountAmount,
                        final_total_price: finalTotalPrice,
                        deposit_original_total: depositPricing.deposit_original_total,
                        deposit_discount: depositPricing.deposit_discount,
                        deposit_total: depositPricing.deposit_total,
                        payable_total_price: payableTotalPrice,
                        deposit_pricing_tiers: depositPricing.tiers,
                        deposit_policy: depositPricing.policy,
                    },
                    applied_voucher: appliedVoucher
                        ? {
                            voucher_id: appliedVoucher.id,
                            code: appliedVoucher.code,
                            discount_type: appliedVoucher.discount_type,
                            discount_value: appliedVoucher.discount_value,
                            max_discount: appliedVoucher.max_discount,
                            discount_amount: appliedVoucher.discount_amount,
                        }
                        : null,
                };
            }); // End of withTransaction

            const auto_assign = {
                trigger: "BOOKING_ORDER_CREATED",
                total: Array.isArray(txResult?.bookings) ? txResult.bookings.length : 0,
                success_count: 0,
                skipped_count: 0,
                failed_count: 0,
                results: [],
            };

            if (txResult && Array.isArray(txResult.bookings)) {
                for (const booking of txResult.bookings) {
                    try {
                        const assignResult = await autoAssignTaskForBooking(booking, { trigger: "BOOKING_ORDER_CREATED" });
                        const reason = assignResult?.reason || "UNKNOWN";
                        const created = Boolean(assignResult?.created);

                        if (created) {
                            auto_assign.success_count += 1;
                        } else {
                            auto_assign.skipped_count += 1;
                        }

                        auto_assign.results.push({
                            booking_id: booking.id,
                            created,
                            reason,
                            task_id: assignResult?.task?.id || null,
                            cleaner_id: assignResult?.task?.cleaner_id || null,
                        });
                    } catch (error) {
                        auto_assign.failed_count += 1;
                        auto_assign.results.push({
                            booking_id: booking.id,
                            created: false,
                            reason: "ERROR",
                            error: error.message || "UNKNOWN_ERROR",
                        });

                        console.error(
                            `Auto assign cleaning task failed (trigger=BOOKING_ORDER_CREATED, booking_id=${booking.id || "unknown"}):`,
                            error.message || error
                        );
                    }
                }
            }

            return {
                ...txResult,
                auto_assign,
            };
        } catch (error) {
            throw error;
        } finally {
            // End session
            session.endSession();
        }
    }

    /**
     * Find available pods for given time range
     * @private
     * @param {Array} pods - List of pods to check
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @returns {Promise<Array>} Available pods
     */
    async _findAvailablePods(pods, startTime, endTime) {
        const availablePods = [];

        for (const pod of pods) {
            // Check if pod has any conflicting bookings
            const conflictingBooking = await Booking.findOne({
                pod_id: pod.id,
                status: { $in: ['BOOKED', 'IN_USE'] },
                $or: [
                    {
                        start_time: { $lt: endTime },
                        end_time: { $gt: startTime }
                    }
                ]
            });

            if (conflictingBooking) {
                continue; // Skip this pod
            }

            // Check if pod has any reserved time slots in the requested range
            const conflictingTimeSlot = await TimeSlot.findOne({
                pod_id: pod.id,
                status: 'RESERVED',
                $or: [
                    {
                        start_time: { $lt: endTime },
                        end_time: { $gt: startTime }
                    }
                ]
            });

            if (!conflictingTimeSlot) {
                availablePods.push(pod);
            }
        }

        return availablePods;
    }

    /**
     * Select pods based on adjacency requirements and floor preference
     * @private
     */
    _selectPodsForBooking(availablePods, podCount, requireAdjacent, floorPreference, acceptFragmented, acceptMixedFloor) {
        // Tổng kiểm tra (Total check)
        if (availablePods.length < podCount) {
            const error = new Error(`Chưa đủ ${podCount} pod trống trong khung giờ này.`);
            error.statusCode = 409;
            error.code = 'OUT_OF_STOCK';
            throw error;
        }

        // Parse Codes
        const podInfo = availablePods.map(pod => {
            const code = pod.code || '';
            const match = code.match(/^([a-zA-Z]*)(\d+)([a-zA-Z]*)$/);
            return {
                pod,
                prefix: match ? match[1].toUpperCase() : 'UNKNOWN',
                number: match ? parseInt(match[2], 10) : 0,
                suffix: match ? match[3].toUpperCase() : 'UNKNOWN',
                originalCode: code
            };
        });

        let bestSelection = [];

        // Bước 1: Lọc lầu (Floor Filter)
        if (floorPreference && (floorPreference === 'U' || floorPreference === 'L')) {
            const preferredPods = podInfo.filter(info => info.suffix === floorPreference);

            if (preferredPods.length >= podCount) {
                // Đủ số lượng trên lầu ưu tiên
                bestSelection = preferredPods;
            } else {
                // Thiếu trên lầu ưu tiên, hỏi người dùng hoặc nếu đã acceptMixedFloor thì lấy trộn
                if (!acceptMixedFloor) {
                    const otherPods = podInfo.filter(info => info.suffix !== floorPreference);
                    const msg = `Chỉ còn ${preferredPods.length} pod trống trên lầu ${floorPreference === 'U' ? 'trên' : 'dưới'} (cần ${podCount}). Hiện đang còn trống ở lầu khác, bạn có đồng ý trộn lầu hoặc đổi lầu không?`;
                    const error = new Error(msg);
                    error.statusCode = 409;
                    error.code = 'CONFIRMATION_REQUIRED_MIXED_FLOOR';
                    error.data = {
                        preferred_floor_count: preferredPods.length,
                        other_floor_count: otherPods.length,
                        total_available: availablePods.length
                    };
                    throw error;
                } else {
                    bestSelection = podInfo;
                }
            }
        } else {
            bestSelection = podInfo;
        }

        // Bước 2 & Bước 3: Kiểm tra liền kề (Adjacency Check)
        if (requireAdjacent && podCount > 1) {
            const groups = {};
            bestSelection.forEach(info => {
                const key = `${info.prefix}_${info.suffix}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push(info);
            });

            let allSegments = [];
            for (const key in groups) {
                const groupPods = groups[key].sort((a, b) => a.number - b.number);
                if (groupPods.length === 0) continue;

                let currentSegment = [groupPods[0]];
                for (let i = 1; i < groupPods.length; i++) {
                    if (groupPods[i].number === groupPods[i - 1].number + 1) {
                        currentSegment.push(groupPods[i]);
                    } else {
                        allSegments.push({ key, pods: currentSegment, length: currentSegment.length });
                        currentSegment = [groupPods[i]];
                    }
                }
                allSegments.push({ key, pods: currentSegment, length: currentSegment.length });
            }

            // Xếp các đoạn (segments) giảm dần theo độ dài
            allSegments.sort((a, b) => b.length - a.length);

            // Cố tìm 1 cụm liên tục N
            const perfectSegment = allSegments.find(seg => seg.length >= podCount);
            if (perfectSegment) {
                return perfectSegment.pods.slice(0, podCount).map(info => info.pod);
            }

            // Nếu phải chia thành nhiều cụm (Vơ cạn - Fragmented)
            // Lấy các khối cần thiết ghép lại
            let selectedPods = [];
            let breakdownDescriptions = [];
            let needed = podCount;

            for (const seg of allSegments) {
                const take = Math.min(seg.length, needed);
                if (take > 0) {
                    selectedPods = selectedPods.concat(seg.pods.slice(0, take));

                    const codeDisplays = seg.pods.slice(0, take).map(p => p.originalCode).join(', ');
                    breakdownDescriptions.push(`${take} pod khu ${seg.key} (${codeDisplays})`);

                    needed -= take;
                }
                if (needed === 0) break;
            }

            if (!acceptFragmented) {
                const msg = `Chúng tôi không tìm được dãy ${podCount} pod liền kề. Phương án tốt nhất hiện có là: ${breakdownDescriptions.join(' và ')}. Bạn có đồng ý không?`;
                const error = new Error(msg);
                error.statusCode = 409;
                error.code = 'CONFIRMATION_REQUIRED_FRAGMENTED';
                error.data = {
                    breakdown: breakdownDescriptions,
                    clusters: breakdownDescriptions.length
                };
                throw error;
            }

            // Nếu khách accept, chọn tổ hợp vừa tìm
            return selectedPods.map(info => info.pod);
        }

        // Default behavior: ưu tiên pod có last_cleaned_at cũ nhất
        // Nếu last_cleaned_at là null, đó là pod mới hoàn toàn -> ưu tiên đầu tiên (hoặc coi như rất cũ)
        bestSelection.sort((a, b) => {
            const timeA = a.pod.last_cleaned_at ? new Date(a.pod.last_cleaned_at).getTime() : 0;
            const timeB = b.pod.last_cleaned_at ? new Date(b.pod.last_cleaned_at).getTime() : 0;
            return timeA - timeB; // Sắp xếp tăng dần: thời gian cũ nhất sẽ lêm trước
        });

        return bestSelection.slice(0, podCount).map(info => info.pod);
    }

    /**
     * Generate time slot documents for a booking time range
     * @private
     * @param {String} podId - Pod ID
     * @param {Date} startTime - Start time
     * @param {Date} endTime - End time
     * @param {Number} slotDurationMinutes - Slot duration in minutes
     * @returns {Array} Array of time slot documents
     */
    _generateTimeSlots(podId, startTime, endTime, slotDurationMinutes = DEFAULT_SLOT_DURATION_MINUTES) {
        const slots = [];
        let currentStart = new Date(startTime);

        while (currentStart < endTime) {
            const currentEnd = new Date(currentStart);
            currentEnd.setMinutes(currentEnd.getMinutes() + slotDurationMinutes);

            // Don't exceed the booking end time
            const slotEnd = currentEnd > endTime ? endTime : currentEnd;

            slots.push({
                pod_id: podId,
                start_time: new Date(currentStart),
                end_time: slotEnd,
                status: 'RESERVED'
            });

            currentStart = new Date(currentEnd);
        }

        return slots;
    }

    /**
     * Schedule order expiration check
     * If order is not paid within the specified minutes, release the slots
     * @private
     * @param {String} orderId - Order ID
     * @param {Number} minutes - Minutes until expiration
     */
    _scheduleOrderExpiration(orderId, minutes) {
        setTimeout(async () => {
            try {
                const order = await BookingOrder.findOne({ id: orderId });

                // Only cancel if still PENDING
                if (order && order.status === 'PENDING') {
                    console.log(`Order ${orderId} expired. Releasing held slots...`);

                    // Get all bookings for this order
                    const bookings = await Booking.find({ order_id: orderId });

                    for (const booking of bookings) {
                        // Get all booking slots
                        const bookingSlots = await BookingSlot.find({ booking_id: booking.id });
                        const timeSlotIds = bookingSlots.map(bs => bs.time_slot_id);

                        // Delete time slots (release them)
                        if (timeSlotIds.length > 0) {
                            await TimeSlot.deleteMany({ id: { $in: timeSlotIds } });
                        }

                        // Delete booking slots
                        await BookingSlot.deleteMany({ booking_id: booking.id });
                    }

                    // Update booking statuses to CANCELLED
                    await Booking.updateMany(
                        { order_id: orderId },
                        { $set: { status: 'CANCELLED' } }
                    );

                    // Update order status to CANCEL (expired unpaid order)
                    order.status = 'CANCEL';
                    await order.save();

                    console.log(`Order ${orderId} cancelled and slots released.`);
                }
            } catch (error) {
                console.error(`Error expiring order ${orderId}:`, error);
            }
        }, minutes * 60 * 1000);
    }

    /**
     * Get booking order by ID
     * @param {String} orderId - Order ID
     * @returns {Promise<Object>} Order with bookings
     */
    async getBookingOrderById(orderId, context = {}) {
        try {
            const actorRole = String(context?.actor?.role || "").toLowerCase();
            const scopedPodIds = this._normalizeIdList(context?.managerScope?.podIds);

            const order = await BookingOrder.findOne({ id: orderId }).lean();

            if (!order) {
                const error = new Error("Booking order not found");
                error.statusCode = 404;
                throw error;
            }

            if (order.user_id) {
                const userDoc = await User.findById(order.user_id).select("name email").lean();
                if (userDoc) {
                    order.user = { name: userDoc.name, email: userDoc.email };
                }
            }

            // Get all bookings for this order
            const bookings = await Booking.find({ order_id: orderId }).lean();
            const pricingDetails = await BookingPricingDetail.find({
                booking_id: { $in: bookings.map((booking) => booking.id) },
            }).lean();

            const pricingDetailMap = pricingDetails.reduce((map, detail) => {
                map[String(detail.booking_id)] = detail;
                return map;
            }, {});

            let visibleBookings = bookings;
            if (actorRole === "manager") {
                if (scopedPodIds.length === 0) {
                    const error = new Error("Manager has no assigned pod scope");
                    error.statusCode = 403;
                    throw error;
                }

                const scopedPodIdSet = new Set(scopedPodIds.map((id) => String(id)));
                visibleBookings = bookings.filter((booking) => scopedPodIdSet.has(String(booking.pod_id)));

                if (visibleBookings.length === 0) {
                    const error = new Error("You are not allowed to access this booking order");
                    error.statusCode = 403;
                    throw error;
                }
            }

            // Manually fetch pod details for each booking (since pod uses custom 'id' field)
            const podIds = [...new Set(visibleBookings.map(b => b.pod_id))];
            const pods = await Pod.find({ id: { $in: podIds } }).lean();
            const podMap = pods.reduce((map, pod) => {
                map[pod.id] = pod;
                return map;
            }, {});

            // Attach pod details to bookings
            const bookingsWithPods = visibleBookings.map(booking => ({
                ...booking,
                pod: podMap[booking.pod_id] || null,
                pricing_detail: pricingDetailMap[String(booking.id)] || null,
            }));

            // Get pod cluster info from booked pods (all pods should belong to the same cluster)
            const clusterIds = [
                ...new Set(
                    pods
                        .map(pod => pod.cluster_id)
                        .filter(Boolean)
                )
            ];

            const podcluster = clusterIds.length > 0
                ? await PodCluster.findOne({ id: clusterIds[0] }).lean()
                : null;

            return {
                order,
                bookings: bookingsWithPods,
                podcluster
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get all booking orders with filters
     * @param {Object} filters - Query filters
     * @returns {Promise<Object>} Orders with pagination
     */
    async getAllBookingOrders(filters = {}, context = {}) {
        try {
            const {
                user_id,
                status,
                start_date,
                end_date,
                pod_ids,
                page = 1,
                limit = 20
            } = filters;

            const actorRole = String(context?.actor?.role || "").toLowerCase();

            let scopedOrderIds = null;
            if (actorRole === "manager") {
                const managerScopedPodIds = this._normalizeIdList(context?.managerScope?.podIds);
                if (managerScopedPodIds.length === 0) {
                    return {
                        orders: [],
                        pagination: {
                            total: 0,
                            page,
                            limit,
                            pages: 0,
                        }
                    };
                }

                scopedOrderIds = await this._findOrderIdsByPodIds(managerScopedPodIds);
            }

            const requestedPodIds = this._normalizeIdList(pod_ids);
            const requestedOrderIds = requestedPodIds.length > 0
                ? await this._findOrderIdsByPodIds(requestedPodIds)
                : null;

            const query = {};

            if (user_id) {
                query.user_id = user_id;
            }

            if (status) {
                query.status = status;
            }

            if (start_date || end_date) {
                query.createdAt = {};
                if (start_date) {
                    query.createdAt.$gte = new Date(start_date);
                }
                if (end_date) {
                    query.createdAt.$lte = new Date(end_date);
                }
            }

            if (scopedOrderIds !== null) {
                if (scopedOrderIds.length === 0) {
                    return {
                        orders: [],
                        pagination: {
                            total: 0,
                            page,
                            limit,
                            pages: 0,
                        }
                    };
                }

                query.id = { $in: scopedOrderIds };
            }

            if (requestedOrderIds !== null) {
                if (requestedOrderIds.length === 0) {
                    return {
                        orders: [],
                        pagination: {
                            total: 0,
                            page,
                            limit,
                            pages: 0,
                        }
                    };
                }

                const existing = query.id && Array.isArray(query.id.$in) ? query.id.$in : null;
                query.id = existing
                    ? { $in: existing.filter((id) => requestedOrderIds.includes(id)) }
                    : { $in: requestedOrderIds };

                if (query.id.$in.length === 0) {
                    return {
                        orders: [],
                        pagination: {
                            total: 0,
                            page,
                            limit,
                            pages: 0,
                        }
                    };
                }
            }

            const skip = (page - 1) * limit;

            const [orders, total] = await Promise.all([
                BookingOrder.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                BookingOrder.countDocuments(query)
            ]);

            // Get bookings count and user details for each order
            const ordersWithCounts = await Promise.all(
                orders.map(async (order) => {
                    const bookingsCount = await Booking.countDocuments({ order_id: order.id });
                    
                    let userData = null;
                    if (order.user_id) {
                        const userDoc = await User.findById(order.user_id).select("name email").lean();
                        if (userDoc) {
                            userData = { name: userDoc.name, email: userDoc.email };
                        }
                    }

                    return {
                        ...order,
                        bookings_count: bookingsCount,
                        user: userData
                    };
                })
            );

            return {
                orders: ordersWithCounts,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Cancel booking order
     * Uses transaction to ensure both order and bookings are cancelled together
     * @param {String} orderId - Order ID
     * @returns {Promise<Object>} Cancelled order
     */
    async cancelBookingOrder(orderId, actor, options = {}) {
        const session = await mongoose.startSession();

        try {
            const cancellationResult = await session.withTransaction(async () => {
                const order = await BookingOrder.findOne({ id: orderId }).session(session);

                if (!order) {
                    const error = new Error("Booking order not found");
                    error.statusCode = 404;
                    throw error;
                }

                const actorId = String(actor?._id || actor?.id || "");
                const isOwner = actorId && actorId === String(order.user_id);
                if (!isOwner) {
                    const error = new Error("Only order owner can cancel this booking order");
                    error.statusCode = 403;
                    throw error;
                }

                if (["CANCEL", "FULLY_CANCELLED"].includes(order.status)) {
                    const error = new Error("Order is already cancelled");
                    error.statusCode = 400;
                    throw error;
                }

                if (!["PENDING", "PAID", "PARTIAL_CANCEL"].includes(order.status)) {
                    const error = new Error(`Cannot cancel order with status ${order.status}`);
                    error.statusCode = 400;
                    throw error;
                }

                // Get all bookings for this order
                const bookings = await Booking.find({ order_id: orderId }).session(session);
                if (bookings.length === 0) {
                    const error = new Error("No bookings found for this order");
                    error.statusCode = 404;
                    throw error;
                }

                const requestedBookingIds = Array.isArray(options.booking_ids)
                    ? [...new Set(options.booking_ids.map((id) => String(id).trim()).filter(Boolean))]
                    : [];

                let targetBookings = [];
                if (requestedBookingIds.length > 0) {
                    const bookingMap = new Map(bookings.map((booking) => [String(booking.id), booking]));
                    const missingIds = requestedBookingIds.filter((id) => !bookingMap.has(id));
                    if (missingIds.length > 0) {
                        const error = new Error(`Invalid booking_ids: ${missingIds.join(", ")}`);
                        error.statusCode = 400;
                        throw error;
                    }

                    targetBookings = requestedBookingIds.map((id) => bookingMap.get(id));
                } else {
                    targetBookings = bookings.filter((booking) => booking.status !== "CANCELLED");
                }

                if (targetBookings.length === 0) {
                    const error = new Error("No active bookings available for cancellation");
                    error.statusCode = 400;
                    throw error;
                }

                const hasStartedOrCompletedBooking = bookings.some(
                    (booking) => booking.status === "IN_USE" || booking.status === "COMPLETED" || !!booking.checked_in_at
                );

                const targetHasStartedOrCompleted = targetBookings.some(
                    (booking) => booking.status === "IN_USE" || booking.status === "COMPLETED" || !!booking.checked_in_at
                );

                if (targetHasStartedOrCompleted) {
                    const error = new Error("Cannot cancel booking that is already in use or completed");
                    error.statusCode = 400;
                    throw error;
                }

                const targetBookedBookings = targetBookings.filter((booking) => booking.status === "BOOKED");
                const targetBookingIds = targetBookedBookings.map((booking) => booking.id);

                if (targetBookingIds.length === 0) {
                    const error = new Error("Selected bookings are already cancelled");
                    error.statusCode = 400;
                    throw error;
                }

                // PENDING order can only be fully cancelled.
                if (order.status === "PENDING" && requestedBookingIds.length > 0) {
                    const error = new Error("PENDING order only supports full cancellation");
                    error.statusCode = 400;
                    throw error;
                }

                if (order.status === "PENDING" && hasStartedOrCompletedBooking) {
                    const error = new Error("Cannot cancel order because one or more bookings are already in use or completed");
                    error.statusCode = 400;
                    throw error;
                }

                await this._releaseBookingResources(targetBookingIds, session);

                await Booking.updateMany(
                    { id: { $in: targetBookingIds } },
                    { $set: { status: 'CANCELLED' } }
                ).session(session);

                if (order.status === "PENDING") {
                    order.status = "CANCEL";
                    await order.save({ session });

                    return {
                        order,
                        cancellation_type: "FULL_CANCEL",
                        cancelled_booking_ids: targetBookingIds,
                        refund: {
                            applicable: false,
                            amount: 0,
                            reason: "Order is unpaid (PENDING)",
                        },
                    };
                }

                const updatedBookings = await Booking.find({ order_id: orderId }).session(session);
                const allCancelled = updatedBookings.every((booking) => booking.status === "CANCELLED");

                const nextOrderStatus = allCancelled ? "FULLY_CANCELLED" : "PARTIAL_CANCEL";
                order.status = nextOrderStatus;

                let repricing = null;
                if (!allCancelled) {
                    repricing = await this._recalculateOrderPricingAfterPartialCancel(order, session);
                } else {
                    await order.save({ session });
                }

                const now = new Date();
                const refundSummary = await this._calculateRefundForBookings(targetBookedBookings, now, session);
                const canRefundBefore48h = refundSummary.eligibleBookings.length === targetBookedBookings.length;

                const rentalRefundAmount = canRefundBefore48h ? refundSummary.refundAmount : 0;
                let depositRefundAmount = 0;
                if (
                    allCancelled
                    && canRefundBefore48h
                    && Number(order.deposit_total || 0) > 0
                    && order.deposit_settlement_status === "PENDING_INSPECTION"
                ) {
                    depositRefundAmount = Number(order.deposit_total || 0);
                    order.deposit_settlement_status = "REFUNDED";
                }

                const totalRefundAmount = Number((rentalRefundAmount + depositRefundAmount).toFixed(2));
                let refundTransaction = null;
                if (totalRefundAmount > 0) {
                    const latestCharge = await Transaction.findOne({
                        order_id: orderId,
                        type: "CHARGE",
                        status: "SUCCESS",
                    })
                        .sort({ created_at: -1 })
                        .session(session);

                    const createdRefundTx = await Transaction.create([{
                        order_id: orderId,
                        amount: totalRefundAmount,
                        currency: "VND",
                        type: "REFUND",
                        method: "VNPAY",
                        status: "SUCCESS",
                        provider_reference: latestCharge?.provider_reference || "AUTO_REFUND_TO_WALLET",
                    }], { session });
                    refundTransaction = createdRefundTx[0];

                    await this._creditWalletWithRefund({
                        session,
                        userId: order.user_id,
                        orderId,
                        rentalRefundAmount,
                        depositRefundAmount,
                        cancelledBookingIds: targetBookingIds,
                        isFullCancel: allCancelled,
                        transactionId: refundTransaction.id,
                    });
                }

                await order.save({ session });

                return {
                    order,
                    cancellation_type: allCancelled ? "FULL_CANCEL" : "PARTIAL_CANCEL",
                    cancelled_booking_ids: targetBookingIds,
                    pricing_adjustment: repricing,
                    refund: {
                        applicable: totalRefundAmount > 0,
                        amount: totalRefundAmount,
                        rental_amount: rentalRefundAmount,
                        deposit_amount: depositRefundAmount,
                        refundable_base_amount: refundSummary.refundableBaseAmount,
                        refund_rate: refundSummary.refundRate,
                        refund_amount_source: refundSummary.amount_source,
                        booking_amounts: refundSummary.booking_amounts,
                        eligible_booking_ids: refundSummary.eligibleBookings.map((booking) => booking.id),
                        refunded_transaction_id: refundTransaction?.id || null,
                        refunded_to_wallet_immediately: totalRefundAmount > 0,
                        policy: refundSummary.policy,
                    },
                };
            });

            try {
                await this._notifyCancellationAndRefund({
                    userId: cancellationResult?.order?.user_id,
                    orderId,
                    cancellationType: cancellationResult?.cancellation_type,
                    cancelledBookingIds: cancellationResult?.cancelled_booking_ids || [],
                    refund: cancellationResult?.refund || {},
                });
            } catch (notifyError) {
                console.error("Cancel notification error:", notifyError);
            }

            return cancellationResult;
        } catch (error) {
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get pending refund requests that manager can process
     * @param {Object} filters - Query filters
     * @param {Object} context - actor and manager scope
     * @returns {Promise<Object>} Pending refund requests with pagination
     */
    async getPendingRefundRequests(filters = {}, context = {}) {
        const actorRole = String(context?.actor?.role || "").toLowerCase();
        if (actorRole !== "manager") {
            const error = new Error("Only manager can view pending refund requests");
            error.statusCode = 403;
            throw error;
        }

        const managerScopedPodIds = this._normalizeIdList(context?.managerScope?.podIds);
        if (managerScopedPodIds.length === 0) {
            return {
                refunds: [],
                pagination: {
                    total: 0,
                    page: 1,
                    limit: 20,
                    pages: 0,
                },
            };
        }

        const scopedOrderIds = await this._findOrderIdsByPodIds(managerScopedPodIds);
        if (scopedOrderIds.length === 0) {
            return {
                refunds: [],
                pagination: {
                    total: 0,
                    page: 1,
                    limit: 20,
                    pages: 0,
                },
            };
        }

        const { order_id, page = 1, limit = 20 } = filters;
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const skip = (currentPage - 1) * pageSize;

        const query = {
            type: "REFUND",
            status: "PENDING",
            order_id: { $in: scopedOrderIds },
        };

        if (order_id) {
            query.order_id = order_id;
            if (!scopedOrderIds.includes(String(order_id))) {
                return {
                    refunds: [],
                    pagination: {
                        total: 0,
                        page: currentPage,
                        limit: pageSize,
                        pages: 0,
                    },
                };
            }
        }

        const [refunds, total] = await Promise.all([
            Transaction.find(query)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(pageSize)
                .lean(),
            Transaction.countDocuments(query),
        ]);

        const orderIds = [...new Set(refunds.map((refund) => String(refund.order_id)).filter(Boolean))];
        const orders = orderIds.length > 0
            ? await BookingOrder.find({ id: { $in: orderIds } })
                .select("id user_id status final_total_price payable_total_price deposit_total deposit_settlement_status")
                .lean()
            : [];
        const orderMap = orders.reduce((map, order) => {
            map[String(order.id)] = order;
            return map;
        }, {});

        return {
            refunds: refunds.map((refund) => ({
                ...refund,
                order: orderMap[String(refund.order_id)] || null,
            })),
            pagination: {
                total,
                page: currentPage,
                limit: pageSize,
                pages: Math.ceil(total / pageSize),
            },
        };
    }

    /**
     * Process pending refund request (approve/reject) by manager
     * @param {String} refundId - Refund transaction ID
     * @param {Object} actor - Authenticated manager
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Updated refund transaction
     */
    async processRefundRequest(refundId, actor, options = {}) {
        const actorRole = String(actor?.role || "").toLowerCase();
        if (actorRole !== "manager") {
            const error = new Error("Only manager can process refund requests");
            error.statusCode = 403;
            throw error;
        }

        const action = String(options.action || "").toUpperCase();
        if (!["APPROVE", "REJECT"].includes(action)) {
            const error = new Error("action must be APPROVE or REJECT");
            error.statusCode = 400;
            throw error;
        }

        const refund = await Transaction.findOne({ id: refundId, type: "REFUND" });
        if (!refund) {
            const error = new Error("Refund request not found");
            error.statusCode = 404;
            throw error;
        }

        if (refund.status !== "PENDING") {
            const error = new Error(`Refund request is already processed with status ${refund.status}`);
            error.statusCode = 400;
            throw error;
        }

        const canAccess = await this._isOrderInManagerScope(refund.order_id, options.managerScope);
        if (!canAccess) {
            const error = new Error("You are not allowed to process this refund request");
            error.statusCode = 403;
            throw error;
        }

        const managerId = String(actor?._id || actor?.id || "");
        const note = String(options.note || "").trim();
        const decisionTag = action === "APPROVE" ? "APPROVED" : "REJECTED";
        const noteTag = note ? `|NOTE:${note.slice(0, 120)}` : "";

        refund.status = action === "APPROVE" ? "SUCCESS" : "VOIDED";
        refund.provider_reference = `${decisionTag}_BY_MANAGER:${managerId}${noteTag}`;
        await refund.save();

        return {
            refund,
            decision: action,
        };
    }

    async applyVoucherToOrder(orderId, actor, payload = {}) {
        const code = this._normalizeVoucherCode(payload.code);
        if (!code) {
            throw this._createError("Voucher code is required", 400);
        }

        const order = await BookingOrder.findOne({ id: orderId });
        if (!order) {
            throw this._createError("Booking order not found", 404);
        }

        const actorId = String(actor?._id || actor?.id || "");
        const isOwner = actorId && actorId === String(order.user_id);
        if (!isOwner) {
            throw this._createError("Only order owner can apply voucher", 403);
        }

        if (order.status !== "PENDING") {
            throw this._createError("Voucher can only be applied to PENDING order", 400);
        }

        const existedRecord = await BookingVoucher.findOne({ order_id: order.id }).select("id").lean();
        if (existedRecord) {
            throw this._createError("This order already has a voucher", 409);
        }

        const voucher = await Voucher.findOne({ code });
        this._assertVoucherEligibility(order, voucher);

        const discountAmount = this._calculateVoucherDiscountAmount(order, voucher);

        const session = await mongoose.startSession();
        try {
            const txResult = await session.withTransaction(async () => {
                const currentOrder = await BookingOrder.findOne({ id: order.id }).session(session);
                if (!currentOrder) {
                    throw this._createError("Booking order not found", 404);
                }

                const duplicate = await BookingVoucher.findOne({ order_id: currentOrder.id })
                    .session(session)
                    .select("id")
                    .lean();
                if (duplicate) {
                    throw this._createError("This order already has a voucher", 409);
                }

                const bookingVoucher = await BookingVoucher.create([
                    {
                        order_id: currentOrder.id,
                        voucher_id: voucher.id,
                        discount_amount: discountAmount,
                        applied_at: new Date(),
                    },
                ], { session });

                currentOrder.total_discount = discountAmount;
                currentOrder.calculateTotal();
                currentOrder.calculatePayableTotal();
                await currentOrder.save({ session });

                return {
                    order: currentOrder,
                    booking_voucher: bookingVoucher[0],
                    voucher,
                };
            });

            return txResult;
        } finally {
            session.endSession();
        }
    }

    async removeVoucherFromOrder(orderId, actor) {
        const order = await BookingOrder.findOne({ id: orderId });
        if (!order) {
            throw this._createError("Booking order not found", 404);
        }

        const actorId = String(actor?._id || actor?.id || "");
        const isOwner = actorId && actorId === String(order.user_id);
        if (!isOwner) {
            throw this._createError("Only order owner can remove voucher", 403);
        }

        if (order.status !== "PENDING") {
            throw this._createError("Voucher can only be removed from PENDING order", 400);
        }

        const session = await mongoose.startSession();
        try {
            const txResult = await session.withTransaction(async () => {
                const currentOrder = await BookingOrder.findOne({ id: order.id }).session(session);
                if (!currentOrder) {
                    throw this._createError("Booking order not found", 404);
                }

                const existing = await BookingVoucher.findOne({ order_id: currentOrder.id }).session(session);
                if (!existing) {
                    throw this._createError("Order has no voucher to remove", 404);
                }

                await BookingVoucher.deleteOne({ id: existing.id }).session(session);

                currentOrder.total_discount = 0;
                currentOrder.calculateTotal();
                currentOrder.calculatePayableTotal();
                await currentOrder.save({ session });

                return {
                    order: currentOrder,
                    removed_booking_voucher_id: existing.id,
                };
            });

            return txResult;
        } finally {
            session.endSession();
        }
    }

    /**
     * Checkout bookings in an order with partial success handling
     * @param {String} orderId - Booking order ID
     * @param {Object} actor - Authenticated user
     * @param {Object} options - Checkout options
     * @returns {Promise<Object>} Checkout summary
     */
    async checkoutOrder(orderId, actor, options = {}) {
        const order = await BookingOrder.findOne({ id: orderId });
        if (!order) {
            const error = new Error("Booking order not found");
            error.statusCode = 404;
            throw error;
        }

        const actorId = String(actor?._id || actor?.id || "");
        const isOwner = actorId && actorId === String(order.user_id);
        if (!isOwner) {
            const error = new Error("Only order owner can checkout this booking order");
            error.statusCode = 403;
            throw error;
        }

        const scope = String(options.scope || "ALL_IN_ORDER").toUpperCase();
        if (!["ALL_IN_ORDER", "SELECTED_BOOKINGS"].includes(scope)) {
            const error = new Error("scope must be ALL_IN_ORDER or SELECTED_BOOKINGS");
            error.statusCode = 400;
            throw error;
        }

        let selectedBookingIds = [];
        if (scope === "SELECTED_BOOKINGS") {
            const bookingIdsFromList = Array.isArray(options.booking_ids)
                ? options.booking_ids
                : [];
            const bookingIdSingle = options.booking_id ? [options.booking_id] : [];

            const mergedBookingIds = [...bookingIdsFromList, ...bookingIdSingle]
                .map((id) => String(id).trim())
                .filter(Boolean);

            if (mergedBookingIds.length === 0) {
                const error = new Error("booking_ids is required when scope is SELECTED_BOOKINGS");
                error.statusCode = 400;
                throw error;
            }

            selectedBookingIds = [...new Set(mergedBookingIds)];
        }

        const bookingQuery = { order_id: orderId };
        if (scope === "SELECTED_BOOKINGS") {
            bookingQuery.id = { $in: selectedBookingIds };
        }

        const bookings = await Booking.find(bookingQuery).sort({ createdAt: 1 });
        if (bookings.length === 0) {
            const error = new Error("No bookings found for checkout");
            error.statusCode = 404;
            throw error;
        }

        const requestedAt = new Date();

        const checked_out = [];
        const skipped = [];
        const auto_assign = {
            trigger: "BOOKING_ORDER_CHECKOUT",
            total: 0,
            success_count: 0,
            skipped_count: 0,
            failed_count: 0,
            results: [],
        };

        for (const booking of bookings) {
            if (booking.status === "COMPLETED") {
                skipped.push({ id: booking.id, reason: "ALREADY_COMPLETED" });
                continue;
            }

            if (booking.status === "CANCELLED") {
                skipped.push({ id: booking.id, reason: "CANCELLED" });
                continue;
            }

            if (booking.status !== "IN_USE") {
                skipped.push({ id: booking.id, reason: "NOT_IN_USE" });
                continue;
            }

            booking.status = "COMPLETED";
            booking.actual_end_time = requestedAt;
            booking.cleaner_access_allowed = true;
            booking.cleaner_access_updated_at = new Date();
            await booking.save();

            auto_assign.total += 1;

            try {
                const assignResult = await autoAssignTaskForBooking(booking, { trigger: "BOOKING_ORDER_CHECKOUT" });
                const reason = assignResult?.reason || "UNKNOWN";
                const created = Boolean(assignResult?.created);

                if (created) {
                    auto_assign.success_count += 1;
                } else {
                    auto_assign.skipped_count += 1;
                }

                auto_assign.results.push({
                    booking_id: booking.id,
                    created,
                    reason,
                    task_id: assignResult?.task?.id || null,
                    cleaner_id: assignResult?.task?.cleaner_id || null,
                });
            } catch (error) {
                auto_assign.failed_count += 1;
                auto_assign.results.push({
                    booking_id: booking.id,
                    created: false,
                    reason: "ERROR",
                    error: error.message || "UNKNOWN_ERROR",
                });

                console.error(
                    `Auto assign cleaning task failed (trigger=BOOKING_ORDER_CHECKOUT, booking_id=${booking.id || "unknown"}):`,
                    error.message || error
                );
            }

            // Create review record after checkout
            await reviewService.createReviewIfNotExists(booking).catch((err) => {
                console.error(`Failed to create review for booking ${booking.id}:`, err.message);
            });

            await notificationService.sendToUser(booking.user_id, {
                title: "Checkout thành công",
                message: "Phiên sử dụng của bạn đã checkout thành công.",
                type: "BOOKING",
                event_code: "BOOKING_CHECKOUT",
                dedupe_key: `BOOKING_CHECKOUT:${booking.id}`,
                data: {
                    type: "BOOKING_CHECKOUT",
                    booking_id: booking.id,
                    order_id: booking.order_id,
                    pod_id: booking.pod_id,
                    checkout_type: requestedAt < booking.end_time ? "EARLY" : "NORMAL",
                },
            });

            // Determine checkout type
            const checkoutType = requestedAt < booking.end_time ? "EARLY" : "NORMAL";

            // Create booking access session for checkout
            await BookingAccessSession.updateOne(
                {
                    booking_id: booking.id,
                    checkin_at: { $ne: null },
                    checkout_at: null, // Only update if not already checked out
                },
                {
                    $set: {
                        checkout_at: requestedAt,
                        checkout_type: checkoutType,
                    },
                }
            );

            checked_out.push({
                id: booking.id,
                pod_id: booking.pod_id,
                status: booking.status,
                actual_end_time: booking.actual_end_time,
            });
        }

        return {
            order_id: order.id,
            scope,
            total_bookings: bookings.length,
            checked_out_count: checked_out.length,
            skipped_count: skipped.length,
            checked_out,
            skipped,
            auto_assign,
        };
    }

    /**
     * Cleanup expired PENDING orders
     * Orders that have been PENDING for more than HOLD_EXPIRATION_MINUTES are cancelled
     * @returns {Promise<Object>} Cleanup result
     */
    async cleanupExpiredOrders() {
        try {
            const expirationTime = new Date();
            expirationTime.setMinutes(expirationTime.getMinutes() - HOLD_EXPIRATION_MINUTES);

            // Find all expired PENDING orders
            const expiredOrders = await BookingOrder.find({
                status: 'PENDING',
                createdAt: { $lt: expirationTime }
            });

            console.log(`Found ${expiredOrders.length} expired order(s) to cleanup`);

            let cancelledCount = 0;
            for (const order of expiredOrders) {
                try {
                    console.log(`Cleaning up expired order ${order.id}...`);

                    // Get all bookings for this order
                    const bookings = await Booking.find({ order_id: order.id });

                    for (const booking of bookings) {
                        // Get all booking slots
                        const bookingSlots = await BookingSlot.find({ booking_id: booking.id });
                        const timeSlotIds = bookingSlots.map(bs => bs.time_slot_id);

                        // Delete time slots (release them)
                        if (timeSlotIds.length > 0) {
                            await TimeSlot.deleteMany({ id: { $in: timeSlotIds } });
                        }

                        // Delete booking slots
                        await BookingSlot.deleteMany({ booking_id: booking.id });
                    }

                    // Update booking statuses to CANCELLED
                    await Booking.updateMany(
                        { order_id: order.id },
                        { $set: { status: 'CANCELLED' } }
                    );

                    // Update order status to CANCEL (expired unpaid order)
                    order.status = 'CANCEL';
                    await order.save();

                    cancelledCount++;
                    console.log(`Order ${order.id} cancelled and slots released.`);
                } catch (err) {
                    console.error(`Error cleaning up order ${order.id}:`, err);
                }
            }

            return {
                found: expiredOrders.length,
                cancelled: cancelledCount
            };
        } catch (error) {
            console.error('Error in cleanupExpiredOrders:', error);
            throw error;
        }
    }

    /**
     * Start periodic cleanup job
     * Runs every 10 minutes to clean up expired PENDING orders
     * @param {Number} intervalMinutes - Interval in minutes (default: 10)
     */
    startCleanupJob(intervalMinutes = 10) {
        console.log(`Starting order cleanup job (interval: ${intervalMinutes} minute(s))`);

        // Run immediately on startup
        this.cleanupExpiredOrders().catch(err =>
            console.error('Initial cleanup failed:', err)
        );

        // Then run periodically
        setInterval(async () => {
            try {
                await this.cleanupExpiredOrders();
            } catch (error) {
                console.error('Cleanup job error:', error);
            }
        }, intervalMinutes * 60 * 1000);
    }
}

module.exports = new BookingOrderService();
