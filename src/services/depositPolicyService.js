const DepositPolicy = require("../models/DepositPolicy");

const POLICY_KEY = "VOLUME_BASED_DEPOSIT_GLOBAL";
const TIER_1_POD_LIMIT = 3;
const TIER_2_POD_LIMIT = 6;

const DEFAULT_POLICY = Object.freeze({
    tier_1_pod_limit: TIER_1_POD_LIMIT,
    tier_2_pod_limit: TIER_2_POD_LIMIT,
    tier_1_price: 500000,
    tier_2_price: 400000,
    tier_3_price: 300000,
});

const createError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const normalizePrice = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw createError(`${fieldName} must be a non-negative integer`, 400);
    }
    return parsed;
};

const mapPolicyResponse = (policyDoc = null) => {
    const policy = {
        ...DEFAULT_POLICY,
        source: policyDoc ? "CUSTOM" : "DEFAULT",
        updated_at: policyDoc ? policyDoc.updated_at : null,
        updated_by: policyDoc ? policyDoc.updated_by : null,
    };

    if (policyDoc) {
        policy.tier_1_price = Number(policyDoc.tier_1_price || DEFAULT_POLICY.tier_1_price);
        policy.tier_2_price = Number(policyDoc.tier_2_price || DEFAULT_POLICY.tier_2_price);
        policy.tier_3_price = Number(policyDoc.tier_3_price || DEFAULT_POLICY.tier_3_price);
    }

    return policy;
};

const assertDescendingTierPrices = ({ tier_1_price, tier_2_price, tier_3_price }) => {
    if (tier_1_price < tier_2_price || tier_2_price < tier_3_price) {
        throw createError(
            "Tier prices must be non-increasing (tier_1_price >= tier_2_price >= tier_3_price)",
            400
        );
    }
};

exports.getCurrentPolicy = async () => {
    const policyDoc = await DepositPolicy.findOne({ policy_key: POLICY_KEY }).lean();
    return mapPolicyResponse(policyDoc);
};

exports.getPolicyForCalculation = async () => {
    return exports.getCurrentPolicy();
};

exports.updateCurrentPolicy = async (data = {}, actorId = null) => {
    const hasAnyField =
        data.tier_1_price !== undefined || data.tier_2_price !== undefined || data.tier_3_price !== undefined;

    if (!hasAnyField) {
        throw createError("At least one tier price is required", 400);
    }

    const currentPolicy = await exports.getCurrentPolicy();

    const nextPolicy = {
        tier_1_price:
            data.tier_1_price !== undefined
                ? normalizePrice(data.tier_1_price, "tier_1_price")
                : currentPolicy.tier_1_price,
        tier_2_price:
            data.tier_2_price !== undefined
                ? normalizePrice(data.tier_2_price, "tier_2_price")
                : currentPolicy.tier_2_price,
        tier_3_price:
            data.tier_3_price !== undefined
                ? normalizePrice(data.tier_3_price, "tier_3_price")
                : currentPolicy.tier_3_price,
    };

    assertDescendingTierPrices(nextPolicy);

    const updatedPolicyDoc = await DepositPolicy.findOneAndUpdate(
        { policy_key: POLICY_KEY },
        {
            $set: {
                policy_key: POLICY_KEY,
                tier_1_price: nextPolicy.tier_1_price,
                tier_2_price: nextPolicy.tier_2_price,
                tier_3_price: nextPolicy.tier_3_price,
                updated_by: actorId ? String(actorId) : null,
            },
        },
        {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return mapPolicyResponse(updatedPolicyDoc);
};
