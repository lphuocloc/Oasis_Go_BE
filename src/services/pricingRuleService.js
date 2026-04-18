const PricingRule = require("../models/PricingRule");
const PodCluster = require("../models/PodCluster");
const Location = require("../models/Location");

class PricingRuleService {
    constructor() {
        this.WEEK_DAYS_BY_UTC_INDEX = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    }

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
        delete data.location_ids;

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

    _normalizeLocationIds(location_ids) {
        if (location_ids === undefined || location_ids === null) return [];

        if (Array.isArray(location_ids)) {
            return [...new Set(location_ids.map((id) => String(id || "").trim()).filter(Boolean))];
        }

        return [...new Set(
            String(location_ids)
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean),
        )];
    }

    async _assertLocationsExist(locationIds = []) {
        if (!Array.isArray(locationIds) || locationIds.length === 0) {
            const error = new Error("At least one location_id is required");
            error.statusCode = 400;
            throw error;
        }

        const existingLocations = await Location.find({ id: { $in: locationIds } })
            .select("id")
            .lean();
        const existingSet = new Set(existingLocations.map((item) => String(item.id)));
        const missingIds = locationIds.filter((id) => !existingSet.has(String(id)));

        if (missingIds.length > 0) {
            const error = new Error(`Location does not exist: ${missingIds.join(", ")}`);
            error.statusCode = 404;
            throw error;
        }
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

    _normalizeUtcTime(value) {
        const raw = String(value || "").trim();
        const parts = raw.split(":");
        if (parts.length === 2) {
            return `${parts[0]}:${parts[1]}:00`;
        }
        return raw;
    }

    _timeToSeconds(timeValue) {
        const normalized = this._normalizeUtcTime(timeValue);
        const [hours, minutes, seconds] = normalized
            .split(":")
            .map((part) => Number(part || 0));
        return hours * 3600 + minutes * 60 + seconds;
    }

    _isRuleMatchedAtUtc(rule, date) {
        if (!rule || !date) return false;

        if (typeof rule.matchesUtcDate === "function") {
            return rule.matchesUtcDate(date);
        }

        const utcDay = this.WEEK_DAYS_BY_UTC_INDEX[date.getUTCDay()];
        const days = Array.isArray(rule.days_of_week)
            ? rule.days_of_week.map((item) => String(item || "").toUpperCase())
            : [];

        if (!days.includes(utcDay)) {
            return false;
        }

        const currentSeconds =
            date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
        const startSeconds = this._timeToSeconds(rule.start_time);
        const endSeconds = this._timeToSeconds(rule.end_time);

        if (startSeconds <= endSeconds) {
            return currentSeconds >= startSeconds && currentSeconds < endSeconds;
        }

        return currentSeconds >= startSeconds || currentSeconds < endSeconds;
    }

    _toIso(date) {
        return new Date(date).toISOString();
    }

    _buildDailyBoundaries(startDate, endDate, rules = []) {
        const boundaries = new Set([
            startDate.getTime(),
            endDate.getTime(),
        ]);

        const startUtcMidnight = Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate(),
            0,
            0,
            0,
            0,
        );
        const endUtcMidnight = Date.UTC(
            endDate.getUTCFullYear(),
            endDate.getUTCMonth(),
            endDate.getUTCDate(),
            0,
            0,
            0,
            0,
        );

        for (let cursor = startUtcMidnight; cursor <= endUtcMidnight + 86400000; cursor += 86400000) {
            boundaries.add(cursor);

            rules.forEach((rule) => {
                const startSeconds = this._timeToSeconds(rule.start_time);
                const endSeconds = this._timeToSeconds(rule.end_time);

                boundaries.add(cursor + startSeconds * 1000);
                boundaries.add(cursor + endSeconds * 1000);

                if (startSeconds > endSeconds) {
                    boundaries.add(cursor + 86400000 + endSeconds * 1000);
                }
            });
        }

        return [...boundaries]
            .filter((ts) => ts >= startDate.getTime() && ts <= endDate.getTime())
            .sort((a, b) => a - b);
    }

    _collectActiveRulesForMoment(rules = [], atUtcDate) {
        return rules.filter((rule) => this._isRuleMatchedAtUtc(rule, atUtcDate));
    }

    calculateSegmentedAmount({ start_at, end_at, base_amount_per_hour, rules = [] } = {}) {
        const startDate = this._toDate(start_at);
        const endDate = this._toDate(end_at);
        const basePerHour = this._toFiniteNumber(base_amount_per_hour, "base_amount_per_hour");

        if (endDate <= startDate) {
            const error = new Error("end_at must be greater than start_at");
            error.statusCode = 400;
            throw error;
        }

        if (basePerHour < 0) {
            const error = new Error("base_amount_per_hour must be greater than or equal to 0");
            error.statusCode = 400;
            throw error;
        }

        const boundaries = this._buildDailyBoundaries(startDate, endDate, rules);
        const segments = [];

        for (let i = 0; i < boundaries.length - 1; i += 1) {
            const segStartMs = boundaries[i];
            const segEndMs = boundaries[i + 1];

            if (segEndMs <= segStartMs) continue;

            const segStartDate = new Date(segStartMs);
            const activeRules = this._collectActiveRulesForMoment(rules, segStartDate);
            const appliedRule = activeRules.sort((a, b) => Number(b.multiplier || 0) - Number(a.multiplier || 0))[0] || null;
            const appliedMultiplier = appliedRule
                ? this._toFiniteNumber(appliedRule.multiplier, "multiplier")
                : 1;

            const durationHours = (segEndMs - segStartMs) / (1000 * 60 * 60);
            const amountRaw = durationHours * basePerHour * appliedMultiplier;

            segments.push({
                start_at_utc: this._toIso(segStartMs),
                end_at_utc: this._toIso(segEndMs),
                duration_hours: Number(durationHours.toFixed(6)),
                applied_multiplier: appliedMultiplier,
                pricing_rule_id: appliedRule?.id || null,
                amount_raw: amountRaw,
                amount: Number(amountRaw.toFixed(2)),
            });
        }

        const totalRawAmount = segments.reduce((sum, segment) => sum + Number(segment.amount_raw || 0), 0);
        const finalAmount = Number(totalRawAmount.toFixed(2));

        return {
            start_at_utc: startDate.toISOString(),
            end_at_utc: endDate.toISOString(),
            duration_hours: Number(((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)).toFixed(6)),
            base_amount_per_hour: basePerHour,
            total_raw_amount: totalRawAmount,
            final_amount: finalAmount,
            segments,
        };
    }

    async _resolveScope({ cluster_id, location_id }) {
        let resolvedLocationId = location_id || null;

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
            location_id: resolvedLocationId,
        };
    }

    _buildScopeOrQuery({ location_id }) {
        const orConditions = [];

        if (location_id) {
            orConditions.push({ location_id });
        }

        return orConditions;
    }

    _sortByPrecedence(rules = []) {
        return [...rules].sort((a, b) => {
            const createdAtA = new Date(a.createdAt || 0).getTime();
            const createdAtB = new Date(b.createdAt || 0).getTime();
            return createdAtB - createdAtA;
        });
    }

    /**
     * Query active pricing rules by location scope and UTC datetime.
     */
    async queryApplicableRules({
        cluster_id,
        location_id,
        at,
        include_inactive = false,
    } = {}) {
        const datetime = this._toDate(at);
        const scope = await this._resolveScope({ cluster_id, location_id });
        const scopeConditions = this._buildScopeOrQuery(scope);

        if (scopeConditions.length === 0) {
            const error = new Error("location_id or cluster_id is required");
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
     * Get the single effective rule for a given location scope and UTC datetime.
     */
    async getEffectiveRule({ cluster_id, location_id, at, include_inactive = false } = {}) {
        const rules = await this.queryApplicableRules({
            cluster_id,
            location_id,
            at,
            include_inactive,
        });

        return rules[0] || null;
    }

    async listPricingRules({
        cluster_id,
        location_id,
        is_active,
        page,
        limit,
    } = {}) {
        const query = {};

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
        const locationIds = this._normalizeLocationIds(payload.location_ids);
        const data = this._normalizeRulePayload(payload);

        if (locationIds.length > 0) {
            await this._assertLocationsExist(locationIds);

            const docs = locationIds.map((locationId) => ({
                ...data,
                location_id: locationId,
            }));

            const rules = await Promise.all(
                docs.map((doc) => PricingRule.create(doc)),
            );
            return rules;
        }

        if (!data.location_id) {
            const error = new Error("location_id is required");
            error.statusCode = 400;
            throw error;
        }

        await this._assertLocationsExist([data.location_id]);
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
        cluster_id,
        location_id,
        at,
        start_at,
        end_at,
        pod_count,
    } = {}) {
        if (!cluster_id) {
            const error = new Error("cluster_id is required");
            error.statusCode = 400;
            throw error;
        }

        const cluster = await PodCluster.findOne({ id: cluster_id })
            .select("id location_id base_price_modifier slot_duration_minutes")
            .lean();

        if (!cluster) {
            const error = new Error("Pod cluster not found");
            error.statusCode = 404;
            throw error;
        }

        const slotDurationMinutes = Number(cluster.slot_duration_minutes || 30);
        const pricePerSlot = Number(cluster.base_price_modifier || 0) * 10000;
        const baseAmountPerHour = pricePerSlot * (60 / slotDurationMinutes);
        const podCount = Math.max(1, parseInt(pod_count, 10) || 1);

        const hasIntervalInput = Boolean(start_at && end_at);

        if (!hasIntervalInput) {
            const datetime = this._toDate(at);
            const matchedRules = await this.queryApplicableRules({
                cluster_id,
                location_id: location_id || cluster.location_id,
                at: datetime,
                include_inactive: false,
            });

            const effectiveRule = matchedRules[0] || null;
            const appliedModifier = effectiveRule
                ? this._toFiniteNumber(effectiveRule.multiplier, "multiplier")
                : 1;

            // Point-in-time quote uses one slot as base for compatibility with existing FE usage.
            const baseAmount = Number(pricePerSlot.toFixed(2));
            const amountPerPod = Number((baseAmount * appliedModifier).toFixed(2));
            const finalAmount = Number((amountPerPod * podCount).toFixed(2));

            return {
                requested_at_utc: datetime.toISOString(),
                cluster_id,
                slot_duration_minutes: slotDurationMinutes,
                pod_count: podCount,
                base_amount: baseAmount,
                amount_per_pod: amountPerPod,
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

        const startDate = this._toDate(start_at);
        const endDate = this._toDate(end_at);

        if (endDate <= startDate) {
            const error = new Error("end_at must be greater than start_at");
            error.statusCode = 400;
            throw error;
        }

        const durationMinutes = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60));
        if (durationMinutes <= 0) {
            const error = new Error("Invalid booking duration");
            error.statusCode = 400;
            throw error;
        }

        if (durationMinutes % slotDurationMinutes !== 0) {
            const error = new Error(
                `Booking duration must be a multiple of ${slotDurationMinutes} minutes for this pod cluster`,
            );
            error.statusCode = 400;
            throw error;
        }

        const scope = await this._resolveScope({ cluster_id, location_id });
        const scopeConditions = this._buildScopeOrQuery(scope);
        const rawRules = scopeConditions.length === 0
            ? []
            : await PricingRule.find({
                $or: scopeConditions,
                is_active: true,
            })
                .sort({ createdAt: -1 })
                .lean(false);

        const segmentation = this.calculateSegmentedAmount({
            start_at: startDate,
            end_at: endDate,
            base_amount_per_hour: baseAmountPerHour,
            rules: rawRules,
        });

        const finalAmount = Number((segmentation.final_amount * podCount).toFixed(2));

        return {
            requested_at_utc: new Date().toISOString(),
            cluster_id,
            slot_duration_minutes: slotDurationMinutes,
            start_at_utc: segmentation.start_at_utc,
            end_at_utc: segmentation.end_at_utc,
            duration_hours: segmentation.duration_hours,
            pod_count: podCount,
            base_amount_per_hour: segmentation.base_amount_per_hour,
            amount_per_pod: segmentation.final_amount,
            final_amount: finalAmount,
            segments: segmentation.segments,
            matched_rule_count: rawRules.length,
        };
    }
}

module.exports = new PricingRuleService();
