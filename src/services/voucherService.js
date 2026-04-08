const Voucher = require("../models/Voucher");

const createError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const toPositiveNumber = (value, fieldName) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        throw createError(`${fieldName} must be a non-negative number`, 400);
    }
    return num;
};

const toDate = (value, fieldName) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw createError(`${fieldName} must be a valid date`, 400);
    }
    return date;
};

const normalizeCode = (code) => String(code || "").trim().toUpperCase();

const validateDateRange = (validFrom, validTo) => {
    if (validFrom && validTo && validTo < validFrom) {
        throw createError("valid_to must be greater than or equal to valid_from", 400);
    }
};

const validateDiscountRule = (discountType, discountValue) => {
    if (discountType === "PERCENT" && discountValue > 100) {
        throw createError("discount_value cannot exceed 100 for PERCENT discount", 400);
    }
};

const parseBooleanFilter = (value) => {
    if (value === undefined) return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw createError("is_active must be true or false", 400);
};

class VoucherService {
    _toVoucherTypeCode(discountType) {
        const normalizedType = String(discountType || "").trim().toUpperCase();
        if (normalizedType === "FIXED") return "FIX";
        if (normalizedType === "PERCENT") return "PCT";
        return "GEN";
    }

    _buildDateCode(date = new Date()) {
        const yy = String(date.getFullYear()).slice(-2);
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        return `${yy}${mm}${dd}`;
    }

    async _generateUniqueVoucherCode(discountType) {
        const dateCode = this._buildDateCode(new Date());
        const typeCode = this._toVoucherTypeCode(discountType);
        const baseCode = `VC-${dateCode}-${typeCode}`;

        const existedBase = await Voucher.findOne({ code: baseCode }).select("id").lean();
        if (!existedBase) {
            return baseCode;
        }

        // If base code already exists, append running suffix to preserve uniqueness.
        for (let seq = 1; seq <= 999; seq += 1) {
            const candidate = `${baseCode}-${String(seq).padStart(3, "0")}`;
            // eslint-disable-next-line no-await-in-loop
            const existed = await Voucher.findOne({ code: candidate }).select("id").lean();
            if (!existed) {
                return candidate;
            }
        }

        throw createError("Failed to generate unique voucher code", 500);
    }

    async createVoucher(payload = {}) {
        const discountType = String(payload.discount_type || "").trim().toUpperCase();
        if (!["PERCENT", "FIXED"].includes(discountType)) {
            throw createError("discount_type must be PERCENT or FIXED", 400);
        }

        const code = await this._generateUniqueVoucherCode(discountType);

        const discountValue = toPositiveNumber(payload.discount_value, "discount_value");
        validateDiscountRule(discountType, discountValue);

        const validFrom = toDate(payload.valid_from, "valid_from");
        const validTo = toDate(payload.valid_to, "valid_to");
        validateDateRange(validFrom, validTo);

        const minBookingValue =
            payload.min_booking_value !== undefined
                ? toPositiveNumber(payload.min_booking_value, "min_booking_value")
                : 0;

        const maxDiscount =
            payload.max_discount !== undefined && payload.max_discount !== null
                ? toPositiveNumber(payload.max_discount, "max_discount")
                : null;

        const usageLimit =
            payload.usage_limit !== undefined && payload.usage_limit !== null
                ? toPositiveNumber(payload.usage_limit, "usage_limit")
                : null;

        const voucher = await Voucher.create({
            code,
            description: payload.description || null,
            discount_type: discountType,
            discount_value: discountValue,
            max_discount: maxDiscount,
            min_booking_value: minBookingValue,
            valid_from: validFrom,
            valid_to: validTo,
            usage_limit: usageLimit,
            usage_count: 0,
            is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
        });

        return voucher;
    }

    async getVouchers(query = {}) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

        const filter = {};
        if (query.code) {
            filter.code = { $regex: normalizeCode(query.code), $options: "i" };
        }
        if (query.discount_type) {
            filter.discount_type = String(query.discount_type).trim().toUpperCase();
        }

        const activeFilter = parseBooleanFilter(query.is_active);
        if (activeFilter !== undefined) {
            filter.is_active = activeFilter;
        }

        const [items, total] = await Promise.all([
            Voucher.find(filter)
                .sort({ created_at: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Voucher.countDocuments(filter),
        ]);

        return {
            items,
            pagination: {
                current_page: page,
                total_pages: Math.ceil(total / limit),
                total_items: total,
                items_per_page: limit,
            },
        };
    }

    async getVoucherById(id) {
        const voucher = await Voucher.findOne({ id });
        if (!voucher) {
            throw createError("Voucher not found", 404);
        }
        return voucher;
    }

    async getVoucherByCode(code) {
        const normalizedCode = normalizeCode(code);
        if (!normalizedCode) {
            throw createError("code is required", 400);
        }

        const voucher = await Voucher.findOne({ code: normalizedCode });
        if (!voucher) {
            throw createError("Voucher not found", 404);
        }
        return voucher;
    }

    async updateVoucher(id, payload = {}) {
        const voucher = await this.getVoucherById(id);

        if (payload.usage_count !== undefined) {
            throw createError("usage_count is managed by payment-success phase and cannot be updated here", 400);
        }

        if (payload.code !== undefined) {
            const code = normalizeCode(payload.code);
            if (!code) {
                throw createError("code cannot be empty", 400);
            }

            const duplicated = await Voucher.findOne({ code, id: { $ne: id } }).select("id").lean();
            if (duplicated) {
                throw createError("Voucher code already exists", 409);
            }
            voucher.code = code;
        }

        if (payload.description !== undefined) {
            voucher.description = payload.description;
        }

        if (payload.discount_type !== undefined) {
            const discountType = String(payload.discount_type).trim().toUpperCase();
            if (!["PERCENT", "FIXED"].includes(discountType)) {
                throw createError("discount_type must be PERCENT or FIXED", 400);
            }
            voucher.discount_type = discountType;
        }

        if (payload.discount_value !== undefined) {
            voucher.discount_value = toPositiveNumber(payload.discount_value, "discount_value");
        }

        const nextDiscountType = voucher.discount_type;
        const nextDiscountValue = Number(voucher.discount_value);
        validateDiscountRule(nextDiscountType, nextDiscountValue);

        if (payload.max_discount !== undefined) {
            voucher.max_discount =
                payload.max_discount === null ? null : toPositiveNumber(payload.max_discount, "max_discount");
        }

        if (payload.min_booking_value !== undefined) {
            voucher.min_booking_value = toPositiveNumber(payload.min_booking_value, "min_booking_value");
        }

        if (payload.valid_from !== undefined) {
            voucher.valid_from = toDate(payload.valid_from, "valid_from");
        }

        if (payload.valid_to !== undefined) {
            voucher.valid_to = toDate(payload.valid_to, "valid_to");
        }

        validateDateRange(voucher.valid_from, voucher.valid_to);

        if (payload.usage_limit !== undefined) {
            voucher.usage_limit =
                payload.usage_limit === null ? null : toPositiveNumber(payload.usage_limit, "usage_limit");
            if (voucher.usage_limit !== null && voucher.usage_count > voucher.usage_limit) {
                throw createError("usage_limit cannot be less than current usage_count", 400);
            }
        }

        if (payload.is_active !== undefined) {
            voucher.is_active = Boolean(payload.is_active);
        }

        await voucher.save();
        return voucher;
    }

    async activateVoucher(id) {
        const voucher = await this.getVoucherById(id);
        voucher.is_active = true;
        await voucher.save();
        return voucher;
    }

    async deactivateVoucher(id) {
        const voucher = await this.getVoucherById(id);
        voucher.is_active = false;
        await voucher.save();
        return voucher;
    }
}

module.exports = new VoucherService();
