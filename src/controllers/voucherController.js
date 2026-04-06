const voucherService = require("../services/voucherService");

exports.createVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.createVoucher(req.body);
        return res.status(201).json({
            success: true,
            message: "Tạo voucher thành công!",
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Tạo voucher thất bại!",
        });
    }
};

exports.getVouchers = async (req, res) => {
    try {
        const result = await voucherService.getVouchers(req.query);
        return res.status(200).json({
            success: true,
            data: result.items,
            pagination: result.pagination,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get vouchers",
        });
    }
};

exports.getVoucherById = async (req, res) => {
    try {
        const voucher = await voucherService.getVoucherById(req.params.id);
        return res.status(200).json({
            success: true,
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get voucher",
        });
    }
};

exports.getVoucherByCode = async (req, res) => {
    try {
        const voucher = await voucherService.getVoucherByCode(req.params.code);
        return res.status(200).json({
            success: true,
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get voucher by code",
        });
    }
};

exports.updateVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.updateVoucher(req.params.id, req.body);
        return res.status(200).json({
            success: true,
            message: "Voucher updated successfully",
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to update voucher",
        });
    }
};

exports.activateVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.activateVoucher(req.params.id);
        return res.status(200).json({
            success: true,
            message: "Voucher activated successfully",
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to activate voucher",
        });
    }
};

exports.deactivateVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.deactivateVoucher(req.params.id);
        return res.status(200).json({
            success: true,
            message: "Voucher deactivated successfully",
            data: voucher,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to deactivate voucher",
        });
    }
};
