const AdminLedgerEntry = require("../models/AdminLedgerEntry");

class AdminLedgerService {
    _parseDateOrThrow(value, fieldName) {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            const error = new Error(`Invalid ${fieldName}`);
            error.statusCode = 400;
            throw error;
        }
        return parsed;
    }

    _normalizeAmount(amount) {
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed < 0) {
            const error = new Error("amount must be a non-negative number");
            error.statusCode = 400;
            throw error;
        }
        return Number(parsed.toFixed(2));
    }

    _buildDateFilter(query = {}) {
        const filter = {};
        if (query.startDate || query.endDate) {
            filter.created_at = {};
            if (query.startDate) {
                filter.created_at.$gte = this._parseDateOrThrow(query.startDate, "startDate");
            }
            if (query.endDate) {
                filter.created_at.$lte = this._parseDateOrThrow(query.endDate, "endDate");
            }
        }
        return filter;
    }

    _normalizePagination(query = {}) {
        const page = Math.max(parseInt(query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
        return { page, limit, skip: (page - 1) * limit };
    }

    _resolveEscrowDelta(type, amount) {
        if (type === "ESCROW_CREDIT") return amount;
        if (type === "ESCROW_DEBIT") return -amount;
        return 0;
    }

    async createEntry(payload, session = null) {
        const amount = this._normalizeAmount(payload.amount);
        const type = String(payload.type || "").trim().toUpperCase();
        const source = String(payload.source || "").trim();
        const dedupeKey = String(payload.dedupe_key || "").trim();

        if (!type) {
            const error = new Error("type is required");
            error.statusCode = 400;
            throw error;
        }
        if (!source) {
            const error = new Error("source is required");
            error.statusCode = 400;
            throw error;
        }
        if (!dedupeKey) {
            const error = new Error("dedupe_key is required");
            error.statusCode = 400;
            throw error;
        }

        let query = AdminLedgerEntry.findOne({ dedupe_key: dedupeKey });
        if (session) {
            query = query.session(session);
        }

        const existing = await query;
        if (existing) {
            return existing;
        }

        const escrowDelta =
            payload.escrow_delta !== undefined && payload.escrow_delta !== null
                ? Number(payload.escrow_delta)
                : this._resolveEscrowDelta(type, amount);

        const entry = {
            type,
            amount,
            escrow_delta: Number(Number(escrowDelta || 0).toFixed(2)),
            currency: payload.currency || "VND",
            source,
            dedupe_key: dedupeKey,
            user_id: payload.user_id || null,
            wallet_id: payload.wallet_id || null,
            order_id: payload.order_id || null,
            transaction_id: payload.transaction_id || null,
            wallet_transaction_id: payload.wallet_transaction_id || null,
            withdrawal_request_id: payload.withdrawal_request_id || null,
            reference_id: payload.reference_id || null,
            description: payload.description || null,
        };

        try {
            const created = await AdminLedgerEntry.create([entry], session ? { session } : undefined);
            return created[0];
        } catch (error) {
            if (error && error.code === 11000) {
                const fallback = await AdminLedgerEntry.findOne({ dedupe_key: dedupeKey });
                if (fallback) return fallback;
            }
            throw error;
        }
    }

    async listEntries(query = {}) {
        const filter = { ...this._buildDateFilter(query) };

        if (query.type) {
            filter.type = String(query.type || "").trim().toUpperCase();
        }
        if (query.source) {
            filter.source = String(query.source || "").trim();
        }
        if (query.order_id) {
            filter.order_id = String(query.order_id || "").trim();
        }
        if (query.user_id) {
            filter.user_id = String(query.user_id || "").trim();
        }
        if (query.wallet_id) {
            filter.wallet_id = String(query.wallet_id || "").trim();
        }
        if (query.transaction_id) {
            filter.transaction_id = String(query.transaction_id || "").trim();
        }
        if (query.reference_id) {
            filter.reference_id = String(query.reference_id || "").trim();
        }

        const { page, limit, skip } = this._normalizePagination(query);

        const [rows, total] = await Promise.all([
            AdminLedgerEntry.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
            AdminLedgerEntry.countDocuments(filter),
        ]);

        // Fetch user details for entries with user_id
        const User = require("../models/User");
        const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
        const userMap = new Map();

        if (userIds.length > 0) {
            const users = await User.find({
                $or: [
                    { _id: { $in: userIds } },
                    { id: { $in: userIds } },
                ],
            })
                .select("_id id name email phone")
                .lean();

            users.forEach((user) => {
                const key = String(user._id || user.id);
                userMap.set(key, {
                    user_name: user.name || null,
                    user_email: user.email || null,
                    user_phone: user.phone || null,
                });
            });
        }

        // Enhance each row with user info
        const enrichedData = rows.map((row) => {
            const userKey = String(row.user_id);
            const userInfo = userMap.get(userKey) || {
                user_name: null,
                user_email: null,
                user_phone: null,
            };
            return { ...row, ...userInfo };
        });

        return {
            data: enrichedData,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getSummary(query = {}) {
        const matchStage = this._buildDateFilter(query);

        const summary = await AdminLedgerEntry.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    escrow_delta: { $sum: "$escrow_delta" },
                    escrow_in: {
                        $sum: {
                            $cond: [{ $gt: ["$escrow_delta", 0] }, "$escrow_delta", 0],
                        },
                    },
                    escrow_out: {
                        $sum: {
                            $cond: [{ $lt: ["$escrow_delta", 0] }, { $abs: "$escrow_delta" }, 0],
                        },
                    },
                    revenue_recognized: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "REVENUE_RECOGNIZED"] }, "$amount", 0],
                        },
                    },
                    payout: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "PAYOUT"] }, "$amount", 0],
                        },
                    },
                    count: { $sum: 1 },
                },
            },
        ]);

        const row = summary && summary[0] ? summary[0] : null;

        return {
            escrow_balance: Number((row?.escrow_delta || 0).toFixed(2)),
            escrow_in: Number((row?.escrow_in || 0).toFixed(2)),
            escrow_out: Number((row?.escrow_out || 0).toFixed(2)),
            revenue_recognized: Number((row?.revenue_recognized || 0).toFixed(2)),
            payout: Number((row?.payout || 0).toFixed(2)),
            total_entries: row?.count || 0,
            time_range: {
                start: query.startDate || null,
                end: query.endDate || null,
            },
        };
    }
}

module.exports = new AdminLedgerService();
