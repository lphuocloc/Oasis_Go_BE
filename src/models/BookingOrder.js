const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingOrderSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            default: () => uuidv4(),
            unique: true,
            required: true,
        },
        user_id: {
            type: String,
            required: [true, "User ID is required"],
            ref: "User",
            index: true,
        },
        total_base_price: {
            type: Number,
            required: [true, "Total base price is required"],
            min: [0, "Total base price cannot be negative"],
            default: 0,
        },
        total_discount: {
            type: Number,
            default: 0,
            min: [0, "Total discount cannot be negative"],
        },
        final_total_price: {
            type: Number,
            required: [true, "Final total price is required"],
            min: [0, "Final total price cannot be negative"],
        },
        status: {
            type: String,
            enum: {
                values: ["PENDING", "PAID", "PARTIALLY_CANCELLED", "CANCELLED"],
                message: "{VALUE} is not a valid status",
            },
            default: "PENDING",
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for efficient queries
bookingOrderSchema.index({ user_id: 1, status: 1 });
bookingOrderSchema.index({ created_at: -1 });
bookingOrderSchema.index({ status: 1, created_at: -1 });

// Virtual for user details
bookingOrderSchema.virtual("user", {
    ref: "User",
    localField: "user_id",
    foreignField: "id",
    justOne: true,
});

// Pre-save validation: final_total_price should be base - discount
bookingOrderSchema.pre("save", function (next) {
    // Auto-calculate final_total_price if not set
    if (!this.isModified("final_total_price") && this.isModified("total_base_price")) {
        this.final_total_price = Math.max(0, this.total_base_price - (this.total_discount || 0));
    }
    next();
});

// Instance method to calculate total
bookingOrderSchema.methods.calculateTotal = function () {
    this.final_total_price = Math.max(0, this.total_base_price - this.total_discount);
    return this.final_total_price;
};

// Instance method to mark as paid
bookingOrderSchema.methods.markAsPaid = async function () {
    if (this.status !== "PENDING") {
        throw new Error(`Cannot mark order as paid from ${this.status} status`);
    }
    this.status = "PAID";
    await this.save();
    return this;
};

// Instance method to cancel order
bookingOrderSchema.methods.cancelOrder = async function () {
    if (this.status === "CANCELLED") {
        throw new Error("Order is already cancelled");
    }
    if (this.status === "PAID") {
        throw new Error("Cannot cancel paid order directly. Use partial cancellation.");
    }
    this.status = "CANCELLED";
    await this.save();
    return this;
};

// Instance method to partially cancel
bookingOrderSchema.methods.partiallyCancelOrder = async function () {
    if (this.status !== "PAID") {
        throw new Error("Can only partially cancel paid orders");
    }
    this.status = "PARTIALLY_CANCELLED";
    await this.save();
    return this;
};

// Static method to get orders by user
bookingOrderSchema.statics.getByUser = async function (userId, status = null) {
    const filter = { user_id: userId };
    if (status) filter.status = status;
    return await this.find(filter).sort({ created_at: -1 });
};

// Static method to get orders by status
bookingOrderSchema.statics.getByStatus = async function (status) {
    return await this.find({ status }).sort({ created_at: -1 });
};

// Static method to get pending orders
bookingOrderSchema.statics.getPending = async function () {
    return await this.find({ status: "PENDING" }).sort({ created_at: -1 });
};

const BookingOrder = mongoose.model("BookingOrder", bookingOrderSchema);

module.exports = BookingOrder;
