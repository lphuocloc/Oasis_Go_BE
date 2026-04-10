const PricingRule = require("../models/PricingRule");
const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");

class PricingRuleService {
    _toFiniteNumber(value, fieldName) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            const error = new Error(`${fieldName} must be a valid number`);
            error.statusCode = 400;
            throw error;
        }
        return num;
    }

    _getRuleScope(rule) {
        if (!rule) return null;
        if (rule.pod_id) return "POD";
        if (rule.location_id) return "LOCATION";
        return null;
    }

    _normalizeDaysOfWeek(days) {
        if (days === undefined) return undefined;

        if (Array.isArray(days)) {
            return days.map((day) => String(day || "").trim().toUpperCase()).filter(Boolean);
        }

        return String(days || "")
            .split(",")
            .map((day) => day.trim().toUpperCase())
            .filter(Boolean);
    }

    _normalizeRulePayload(payload = {}, { partial = false } = {}) {
        const data = { ...payload };

        if (data.price_modifier !== undefined && data.multiplier === undefined) {
            data.multiplier = data.price_modifier;
        }
        delete data.price_modifier;

        delete data.pricing_type;
        delete data.priority;
        delete data.cluster_id;

        const normalizedDays = this._normalizeDaysOfWeek(data.days_of_week);
        if (normalizedDays !== undefined) {
            data.days_of_week = normalizedDays;
        }

        if (data.multiplier !== undefined) {
            data.multiplier = Number(data.multiplier);
        }

        if (data.is_active !== undefined) {
            data.is_active =
                data.is_active === true ||
                String(data.is_active).trim().toLowerCase() === "true" ||
                String(data.is_active).trim() === "1";
        }

        if (!partial) {
            return data;
        }

        Object.keys(data).forEach((key) => {
            if (data[key] === undefined) {
                delete data[key];
            }
        });

        return data;
    }

    _toDate(value) {
        if (!value) return new Date();
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) {
            const error = new Error("Invalid datetime provided");
            error.statusCode = 400;
            throw error;
        }
        return date;
    }

    async _resolveScope({ pod_id, cluster_id, location_id }) {
        let resolvedPodId = pod_id || null;
        let resolvedLocationId = location_id || null;

        if (resolvedPodId && !resolvedLocationId) {
            const pod = await Pod.findOne({ id: resolvedPodId }).select("id cluster_id").lean();
            if (!pod) {
                const error = new Error("Pod not found");
                error.statusCode = 404;
                throw error;
            }
            const cluster = await PodCluster.findOne({ id: pod.cluster_id }).select("id location_id").lean();
            if (!cluster) {
                const error = new Error("Pod cluster not found");
                error.statusCode = 404;
                throw error;
            }
            resolvedLocationId = cluster.location_id;
        }

        if (cluster_id && !resolvedLocationId) {
            const cluster = await PodCluster.findOne({ id: cluster_id }).select("id location_id").lean();
            if (!cluster) {
                const error = new Error("Pod cluster not found");
                error.statusCode = 404;
                throw error;
            }
            resolvedLocationId = cluster.location_id;
        }

        return {
            pod_id: resolvedPodId,
            location_id: resolvedLocationId,
        };
    }

    _buildScopeOrQuery({ pod_id, location_id }) {
        const orConditions = [];

        if (pod_id) {
            orConditions.push({ pod_id });
        }

        if (location_id) {
            orConditions.push({ location_id });
        }

        return orConditions;
    }

    _scopeRank(rule) {
        if (rule.pod_id) return 2;
        if (rule.location_id) return 1;
        return 0;
    }

    _sortByPrecedence(rules = []) {
        return [...rules].sort((a, b) => {
            const scopeDelta = this._scopeRank(b) - this._scopeRank(a);
            if (scopeDelta !== 0) return scopeDelta;

            const createdAtA = new Date(a.createdAt || 0).getTime();
            const createdAtB = new Date(b.createdAt || 0).getTime();
            return createdAtB - createdAtA;
        });
    }

    /**
     * Query active pricing rules by scope and UTC datetime.
        * Precedence order when consuming result: pod > location, then latest created.
     */
    async queryApplicableRules({
        pod_id,
        cluster_id,
        location_id,
        at,
        include_inactive = false,
    } = {}) {
        const datetime = this._toDate(at);
        const scope = await this._resolveScope({ pod_id, cluster_id, location_id });
        const scopeConditions = this._buildScopeOrQuery(scope);

        if (scopeConditions.length === 0) {
            const error = new Error("At least one of pod_id or location_id is required");
            error.statusCode = 400;
            throw error;
        }

        const query = {
            $or: scopeConditions,
        };

        if (!include_inactive) {
            query.is_active = true;
        }

        const rawRules = await PricingRule.find(query)
            .sort({ createdAt: -1 })
            .lean(false);

        const matchedRules = rawRules.filter((rule) => rule.matchesUtcDate(datetime));
        return this._sortByPrecedence(matchedRules);
    }

    /**
     * Get the single highest-precedence rule for a given scope and UTC datetime.
     */
    async getEffectiveRule({ pod_id, cluster_id, location_id, at, include_inactive = false } = {}) {
        const rules = await this.queryApplicableRules({
            pod_id,
            cluster_id,
            location_id,
            at,
            include_inactive,
        });

        return rules[0] || null;
    }

    async listPricingRules({
        pod_id,
        cluster_id,
        location_id,
        is_active,
        page,
        limit,
    } = {}) {
        const query = {};

        if (pod_id) query.pod_id = pod_id;
        if (location_id) query.location_id = location_id;

        // Legacy filter: cluster_id now maps to location scope for convenience.
        if (cluster_id && !location_id) {
            const cluster = await PodCluster.findOne({ id: cluster_id }).select("id location_id").lean();
            if (cluster?.location_id) {
                query.location_id = cluster.location_id;
            }
        }

        if (is_active !== undefined && is_active !== null && is_active !== "") {
            const normalized = String(is_active).trim().toLowerCase();
            query.is_active = ["true", "1", "yes", "y"].includes(normalized);
        }

        const hasPagination = page !== undefined || limit !== undefined;

        if (!hasPagination) {
            const rules = await PricingRule.find(query).sort({ createdAt: -1 });
            return {
                rules,
                pagination: null,
            };
        }

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        const [rules, total] = await Promise.all([
            PricingRule.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
            PricingRule.countDocuments(query),
        ]);

        return {
            rules,
            pagination: {
                current_page: pageNum,
                total_pages: Math.ceil(total / limitNum),
                total_items: total,
                items_per_page: limitNum,
            },
        };
    }

    async createPricingRule(payload = {}) {
        const data = this._normalizeRulePayload(payload);
        const rule = await PricingRule.create(data);
        return rule;
    }

    async updatePricingRule(ruleId, payload = {}) {
        const rule = await PricingRule.findOne({ id: ruleId });
        if (!rule) {
            const error = new Error("Pricing rule not found");
            error.statusCode = 404;
            throw error;
        }

        const data = this._normalizeRulePayload(payload, { partial: true });

        Object.keys(data).forEach((key) => {
            rule[key] = data[key];
        });

        await rule.save();
        return rule;
    }

    async softDeletePricingRule(ruleId) {
        const rule = await PricingRule.findOne({ id: ruleId });
        if (!rule) {
            const error = new Error("Pricing rule not found");
            error.statusCode = 404;
            throw error;
        }

        if (!rule.is_active) {
            return rule;
        }

        rule.is_active = false;
        await rule.save();
        return rule;
    }

    async getProvisionalQuote({
        pod_id,
        cluster_id,
        location_id,
        at,
        base_amount,
    } = {}) {
        const baseAmount = this._toFiniteNumber(base_amount, "base_amount");
        if (baseAmount < 0) {
            const error = new Error("base_amount must be greater than or equal to 0");
            error.statusCode = 400;
            throw error;
        }

        const datetime = this._toDate(at);
        const matchedRules = await this.queryApplicableRules({
            pod_id,
            cluster_id,
            location_id,
            at: datetime,
            include_inactive: false,
        });

        const effectiveRule = matchedRules[0] || null;
        const appliedModifier = effectiveRule
            ? this._toFiniteNumber(effectiveRule.multiplier, "multiplier")
            : 1;
        const finalAmount = Math.round(baseAmount * appliedModifier);

        return {
            requested_at_utc: datetime.toISOString(),
            base_amount: baseAmount,
            applied_modifier: appliedModifier,
            final_amount: finalAmount,
            effective_rule: effectiveRule
                ? {
                    id: effectiveRule.id,
                    scope: this._getRuleScope(effectiveRule),
                    multiplier: effectiveRule.multiplier,
                    start_time: effectiveRule.start_time,
                    end_time: effectiveRule.end_time,
                    days_of_week: effectiveRule.days_of_week,
                }
                : null,
            matched_rules: matchedRules.map((rule, index) => ({
                id: rule.id,
                scope: this._getRuleScope(rule),
                multiplier: rule.multiplier,
                is_applied: index === 0,
                reason: index === 0 ? "Selected as highest precedence rule" : "Overridden by higher precedence rule",
            })),
        };
    }
}

module.exports = new PricingRuleService();
