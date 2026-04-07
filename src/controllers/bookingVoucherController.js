const bookingVoucherService = require("../services/bookingVoucherService");

exports.createBookingVoucher = async (req, res) => {
    try {
        const record = await bookingVoucherService.createBookingVoucher(req.body);
        return res.status(201).json({
            success: true,
            message: "Booking voucher record created successfully",
            data: record,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to create booking voucher record",
        });
    }
};

exports.getBookingVouchers = async (req, res) => {
    try {
        const result = await bookingVoucherService.getBookingVouchers(req.query);
        return res.status(200).json({
            success: true,
            data: result.items,
            pagination: result.pagination,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get booking voucher records",
        });
    }
};

exports.getBookingVoucherById = async (req, res) => {
    try {
        const record = await bookingVoucherService.getBookingVoucherById(req.params.id);
        return res.status(200).json({
            success: true,
            data: record,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get booking voucher record",
        });
    }
};

exports.deleteBookingVoucher = async (req, res) => {
    try {
        const result = await bookingVoucherService.deleteBookingVoucher(req.params.id);
        return res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to delete booking voucher record",
        });
    }
};
