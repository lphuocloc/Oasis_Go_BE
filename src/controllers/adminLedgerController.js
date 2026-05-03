const adminLedgerService = require("../services/adminLedgerService");

exports.getLedgerEntries = async (req, res) => {
    try {
        const result = await adminLedgerService.listEntries(req.query || {});
        res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching admin ledger entries",
        });
    }
};

exports.getLedgerSummary = async (req, res) => {
    try {
        const result = await adminLedgerService.getSummary(req.query || {});
        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching admin ledger summary",
        });
    }
};
