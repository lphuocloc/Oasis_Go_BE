const depositPolicyService = require("../services/depositPolicyService");

exports.getCurrentPolicy = async (req, res) => {
    try {
        const policy = await depositPolicyService.getCurrentPolicy();
        return res.status(200).json({
            success: true,
            data: policy,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get deposit policy",
        });
    }
};

exports.updateCurrentPolicy = async (req, res) => {
    try {
        const actorId = req.user?.id || req.user?.user_id || null;
        const policy = await depositPolicyService.updateCurrentPolicy(req.body, actorId);

        return res.status(200).json({
            success: true,
            message: "Deposit pricing policy updated successfully",
            data: policy,
        });
    } catch (error) {
        return res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to update deposit policy",
        });
    }
};
