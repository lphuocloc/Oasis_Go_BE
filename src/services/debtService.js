const mongoose = require("mongoose");
const DebtRecord = require("../models/DebtRecord");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const Transaction = require("../models/Transaction");
const BookingOrder = require("../models/BookingOrder");
const notificationService = require("./notificationService");

class DebtService {
    constructor() {
        this._agingTimer = null;
    }

    _roundMoney(value) {
        const parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;
        return Number(parsed.toFixed(2));
    }

    _daysOverdue(dueAt, now = new Date()) {
        const dueDate = dueAt ? new Date(dueAt) : new Date(now);
        return Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
    }

    _agingBucketByDays(daysOverdue) {
        if (daysOverdue >= 14) return "BLACKLISTED";
        if (daysOverdue >= 7) return "D7_D30";
        return "LT_7";
    }

    async _sumActiveDebtByUser(userId, session = null) {
        const query = DebtRecord.aggregate([
            {
                $match: {
                    user_id: String(userId),
                    status: "ACTIVE",
                    remaining_amount: { $gt: 0 },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$remaining_amount" },
                    oldest_created_at: { $min: "$created_at" },
                },
            },
        ]);

        if (session) {
            query.session(session);
        }

        const rows = await query;
        if (!rows.length) {
            return {
                total: 0,
                oldestCreatedAt: null,
            };
        }

        return {
            total: this._roundMoney(rows[0].total || 0),
            oldestCreatedAt: rows[0].oldest_created_at || null,
        };
    }

    async syncUserDebtState(userId, session = null) {
        const normalizedUserId = String(userId || "").trim();
        if (!normalizedUserId) {
            return null;
        }

        let userQuery = User.findOne({ _id: normalizedUserId });
        if (session) userQuery = userQuery.session(session);
        const user = await userQuery;

        if (!user) {
            return null;
        }

        const debtSummary = await this._sumActiveDebtByUser(normalizedUserId, session);

        const currentStatus = String(user.debt_status || "NONE").toUpperCase();
        const nextStatus = debtSummary.total > 0
            ? (currentStatus === "BLACKLISTED" ? "BLACKLISTED" : "IN_DEBT")
            : "NONE";

        user.debt_total_cached = debtSummary.total;
        user.debt_status = nextStatus;
        user.debt_since = debtSummary.total > 0 ? (user.debt_since || debtSummary.oldestCreatedAt || new Date()) : null;

        await user.save(session ? { session } : undefined);
        return user;
    }

    async recordOrderOutstandingDebt(
        {
            userId,
            orderId,
            outstandingAmount,
            incidentBreakdown = [],
            trigger = "SYSTEM",
            dueAt = null,
            settledAt = null,
        },
        session = null,
    ) {
        const normalizedUserId = String(userId || "").trim();
        const normalizedOrderId = String(orderId || "").trim();
        if (!normalizedUserId || !normalizedOrderId) {
            return null;
        }

        const remainingAmount = this._roundMoney(Number(outstandingAmount || 0));
        const incidentIds = Array.isArray(incidentBreakdown)
            ? incidentBreakdown.map((entry) => String(entry?.incident_id || "")).filter(Boolean)
            : [];

        let debtQuery = DebtRecord.findOne({ order_id: normalizedOrderId });
        if (session) debtQuery = debtQuery.session(session);
        let debtRecord = await debtQuery;

        if (remainingAmount <= 0) {
            if (debtRecord && debtRecord.status === "ACTIVE") {
                debtRecord.remaining_amount = 0;
                debtRecord.status = "SETTLED";
                debtRecord.settled_at = settledAt || new Date();
                debtRecord.metadata = {
                    ...(debtRecord.metadata || {}),
                    settlement_trigger: trigger,
                    latest_incident_ids: incidentIds,
                };
                await debtRecord.save(session ? { session } : undefined);
            }

            await this.syncUserDebtState(normalizedUserId, session);
            return debtRecord;
        }

        if (!debtRecord) {
            debtRecord = new DebtRecord({
                user_id: normalizedUserId,
                order_id: normalizedOrderId,
            });
        }

        debtRecord.user_id = normalizedUserId;
        debtRecord.incident_ids = incidentIds;
        debtRecord.principal_amount = remainingAmount;
        debtRecord.remaining_amount = remainingAmount;
        debtRecord.status = "ACTIVE";
        debtRecord.aging_bucket = "LT_7";
        debtRecord.due_at = dueAt ? new Date(dueAt) : new Date();
        debtRecord.settled_at = null;
        debtRecord.metadata = {
            ...(debtRecord.metadata || {}),
            settlement_trigger: trigger,
            updated_at: new Date().toISOString(),
            incident_breakdown: incidentBreakdown,
        };

        await debtRecord.save(session ? { session } : undefined);
        await this.syncUserDebtState(normalizedUserId, session);
        return debtRecord;
    }

    async settleUserDebtFromWallet({ userId, trigger = "TOPUP" } = {}) {
        const normalizedUserId = String(userId || "").trim();
        if (!normalizedUserId) {
            return {
                settled_amount: 0,
                remaining_debt: 0,
                wallet_balance_after: 0,
            };
        }

        const session = await mongoose.startSession();
        let result = {
            settled_amount: 0,
            remaining_debt: 0,
            wallet_balance_after: 0,
        };

        try {
            await session.withTransaction(async () => {
                const wallet = await Wallet.findOne({ user_id: normalizedUserId }).session(session);
                if (!wallet) {
                    result = {
                        settled_amount: 0,
                        remaining_debt: 0,
                        wallet_balance_after: 0,
                    };
                    return;
                }

                let availableBalance = this._roundMoney(Number(wallet.balance || 0));
                if (availableBalance <= 0) {
                    const debtSummary = await this._sumActiveDebtByUser(normalizedUserId, session);
                    await this.syncUserDebtState(normalizedUserId, session);
                    result = {
                        settled_amount: 0,
                        remaining_debt: debtSummary.total,
                        wallet_balance_after: availableBalance,
                    };
                    return;
                }

                const debtRecords = await DebtRecord.find({
                    user_id: normalizedUserId,
                    status: "ACTIVE",
                    remaining_amount: { $gt: 0 },
                })
                    .sort({ due_at: 1, created_at: 1 })
                    .session(session);

                let settledAmount = 0;

                for (const debt of debtRecords) {
                    if (availableBalance <= 0) break;

                    const currentDebt = this._roundMoney(Number(debt.remaining_amount || 0));
                    if (currentDebt <= 0) continue;

                    const payAmount = this._roundMoney(Math.min(availableBalance, currentDebt));
                    if (payAmount <= 0) continue;

                    const balanceBefore = availableBalance;
                    const balanceAfter = this._roundMoney(balanceBefore - payAmount);

                    const createdPenaltyTx = await Transaction.create(
                        [
                            {
                                order_id: debt.order_id,
                                amount: payAmount,
                                currency: "VND",
                                type: "PENALTY",
                                method: "WALLET",
                                status: "SUCCESS",
                                provider_reference: `DEBT_SETTLEMENT:${debt.id}:${trigger}:${Date.now()}`,
                            },
                        ],
                        { session }
                    );

                    await WalletTransaction.create(
                        [
                            {
                                wallet_id: wallet.id,
                                amount: payAmount,
                                type: "PAYMENT",
                                transaction_id: createdPenaltyTx[0].id,
                                reference_id: debt.id,
                                description: `Auto settle debt for order ${debt.order_id}`,
                                balance_before: balanceBefore,
                                balance_after: balanceAfter,
                            },
                        ],
                        { session }
                    );

                    availableBalance = balanceAfter;
                    settledAmount = this._roundMoney(settledAmount + payAmount);

                    debt.remaining_amount = this._roundMoney(currentDebt - payAmount);
                    if (debt.remaining_amount <= 0) {
                        debt.remaining_amount = 0;
                        debt.status = "SETTLED";
                        debt.settled_at = new Date();
                    }

                    debt.metadata = {
                        ...(debt.metadata || {}),
                        last_settlement_trigger: trigger,
                        last_settlement_at: new Date().toISOString(),
                    };

                    await debt.save({ session });

                    await BookingOrder.updateOne(
                        { id: debt.order_id },
                        { $set: { outstanding_damage_amount: debt.remaining_amount } },
                        { session }
                    );
                }

                wallet.balance = availableBalance;
                await wallet.save({ session });

                const debtSummary = await this._sumActiveDebtByUser(normalizedUserId, session);
                await this.syncUserDebtState(normalizedUserId, session);

                result = {
                    settled_amount: settledAmount,
                    remaining_debt: debtSummary.total,
                    wallet_balance_after: availableBalance,
                };
            });
        } finally {
            await session.endSession();
        }

        return result;
    }

    async runAgingDebtJob() {
        const now = new Date();
        const debtRecords = await DebtRecord.find({
            status: "ACTIVE",
            remaining_amount: { $gt: 0 },
        }).select("id user_id order_id due_at aging_bucket last_reminder_at remaining_amount");

        for (const debt of debtRecords) {
            const daysOverdue = this._daysOverdue(debt.due_at, now);
            const nextBucket = this._agingBucketByDays(daysOverdue);
            const previousBucket = String(debt.aging_bucket || "LT_7");
            const enteringBlacklisted = previousBucket !== "BLACKLISTED" && nextBucket === "BLACKLISTED";
            const isReminderWindow = daysOverdue >= 1 && daysOverdue <= 7;
            const shouldRemind =
                !debt.last_reminder_at || (now.getTime() - new Date(debt.last_reminder_at).getTime()) >= 24 * 60 * 60 * 1000;

            if (previousBucket !== nextBucket) {
                debt.aging_bucket = nextBucket;
            }

            if (nextBucket === "BLACKLISTED") {
                await User.updateOne(
                    { _id: debt.user_id },
                    { $set: { debt_status: "BLACKLISTED" } }
                );
            }

            if (shouldRemind) {
                if (isReminderWindow) {
                    await notificationService.sendToUser(debt.user_id, {
                        title: "Outstanding debt reminder",
                        message: `Order ${debt.order_id} has outstanding debt ${Number(debt.remaining_amount || 0).toLocaleString("vi-VN")} VND. Please settle soon.`,
                        type: "PAYMENT",
                        event_code: "DEBT_REMINDER",
                        dedupe_key: `DEBT_REMINDER:${debt.id}:${now.toISOString().slice(0, 10)}`,
                        data: {
                            debt_record_id: debt.id,
                            order_id: debt.order_id,
                            aging_bucket: nextBucket,
                            remaining_amount: String(debt.remaining_amount || 0),
                        },
                    });
                    debt.last_reminder_at = now;
                } else if (enteringBlacklisted) {
                    await notificationService.sendToUser(debt.user_id, {
                        title: "Account blacklisted due to debt",
                        message: `Order ${debt.order_id} debt is overdue more than 14 days. Account is now blacklisted.`,
                        type: "PAYMENT",
                        event_code: "DEBT_BLACKLISTED",
                        dedupe_key: `DEBT_BLACKLISTED:${debt.id}:${now.toISOString().slice(0, 10)}`,
                        data: {
                            debt_record_id: debt.id,
                            order_id: debt.order_id,
                            aging_bucket: nextBucket,
                            remaining_amount: String(debt.remaining_amount || 0),
                        },
                    });

                    debt.last_reminder_at = now;
                }
            }

            await debt.save();
            await this.syncUserDebtState(debt.user_id);
        }
    }

    startAgingDebtJob(intervalHours = 24) {
        const safeHours = Number(intervalHours);
        const hours = Number.isFinite(safeHours) && safeHours > 0 ? safeHours : 24;

        if (this._agingTimer) {
            clearInterval(this._agingTimer);
            this._agingTimer = null;
        }

        console.log(`Starting debt aging job (interval: ${hours} hour(s))`);

        this._agingTimer = setInterval(async () => {
            try {
                await this.runAgingDebtJob();
            } catch (error) {
                console.error("Debt aging job failed", error?.message || error);
            }
        }, hours * 60 * 60 * 1000);
    }
}

module.exports = new DebtService();
