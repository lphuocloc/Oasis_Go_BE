const pricingRuleService = require("../services/pricingRuleService");

const parseBoolean = (value, defaultValue = false) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    return defaultValue;
};

const mapEffectiveRulePayload = (rule) => {
    if (!rule) return null;

    return {
        id: rule.id,
        scope: "LOCATION",
        multiplier: Number(rule.multiplier ?? rule.price_modifier ?? 1),
        start_time: rule.start_time,
        end_time: rule.end_time,
        days_of_week: rule.days_of_week,
        is_active: rule.is_active,
    };
};

exports.listPricingRules = async (req, res) => {
    try {
        const {
            cluster_id,
            location_id,
            pricing_type,
            is_active,
            page,
            limit,
        } = req.query;

        const result = await pricingRuleService.listPricingRules({
            cluster_id,
            location_id,
            pricing_type,
            is_active,
            page,
            limit,
        });

        res.status(200).json({
            success: true,
            message: "Pricing rules listed successfully",
            data: result.rules,
            pagination: result.pagination,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to list pricing rules",
        });
    }
};

exports.createPricingRule = async (req, res) => {
    try {
        const rule = await pricingRuleService.createPricingRule(req.body);
        const isBulk = Array.isArray(rule);

        res.status(201).json({
            success: true,
            message: isBulk
                ? "Pricing rules created successfully"
                : "Pricing rule created successfully",
            count: isBulk ? rule.length : 1,
            data: rule,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to create pricing rule",
        });
    }
};

exports.updatePricingRule = async (req, res) => {
    try {
        const rule = await pricingRuleService.updatePricingRule(req.params.id, req.body);

        res.status(200).json({
            success: true,
            message: "Pricing rule updated successfully",
            data: rule,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to update pricing rule",
        });
    }
};

exports.deletePricingRule = async (req, res) => {
    try {
        const rule = await pricingRuleService.softDeletePricingRule(req.params.id);

        res.status(200).json({
            success: true,
            message: "Pricing rule deactivated successfully",
            data: rule,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to delete pricing rule",
        });
    }
};



exports.getEffectiveRule = async (req, res) => {
    try {
        const {
            cluster_id,
            location_id,
            pricing_type,
            at,
            include_inactive,
        } = req.query;

        const rule = await pricingRuleService.getEffectiveRule({
            cluster_id,
            location_id,
            pricing_type,
            at,
            include_inactive: parseBoolean(include_inactive, false),
        });

        res.status(200).json({
            success: true,
            message: "Effective pricing rule retrieved successfully",
            data: rule,
            effective_rule: mapEffectiveRulePayload(rule),
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to get effective pricing rule",
        });
    }
};

exports.getProvisionalQuote = async (req, res) => {
    try {
        const {
            cluster_id,
            location_id,
            at,
            start_at,
            end_at,
            pod_count,
            pricing_type,
        } = req.query;

        const quote = await pricingRuleService.getProvisionalQuote({
            cluster_id,
            location_id,
            at,
            start_at,
            end_at,
            pod_count,
            pricing_type,
        });

        res.status(200).json({
            success: true,
            message: "Provisional quote calculated successfully",
            data: quote,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to calculate provisional quote",
        });
    }
};
