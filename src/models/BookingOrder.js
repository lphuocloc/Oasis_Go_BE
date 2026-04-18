const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const depositSettlementSnapshotSchema = new mongoose.Schema(
  {
    settled_at: { type: Date, default: null },
    trigger: { type: String, default: null, trim: true },
    total_resolved_incident_damage: { type: Number, default: 0, min: 0 },
    deposit_used: { type: Number, default: 0, min: 0 },
    refunded_to_wallet_amount: { type: Number, default: 0, min: 0 },
    wallet_debit_amount: { type: Number, default: 0, min: 0 },
    outstanding_amount: { type: Number, default: 0, min: 0 },
    incident_breakdown: {
      type: [
        {
          incident_id: { type: String, required: true },
          booking_id: { type: String, default: null },
          amount: { type: Number, default: 0, min: 0 },
          status: { type: String, default: null },
        },
      ],
      default: [],
    },
  },
  { _id: false },
);

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
    deposit_original_total: {
      type: Number,
      default: 0,
      min: [0, "Deposit original total cannot be negative"],
    },
    deposit_discount: {
      type: Number,
      default: 0,
      min: [0, "Deposit discount cannot be negative"],
    },
    deposit_total: {
      type: Number,
      default: 0,
      min: [0, "Deposit total cannot be negative"],
    },
    payable_total_price: {
      type: Number,
      required: [true, "Payable total price is required"],
      min: [0, "Payable total price cannot be negative"],
      default: 0,
    },
    deposit_settlement_status: {
      type: String,
      enum: {
        values: [
          "PENDING_INSPECTION",
          "REFUNDED",
          "PARTIALLY_FORFEITED",
          "FORFEITED",
        ],
        message: "{VALUE} is not a valid deposit settlement status",
      },
      default: "PENDING_INSPECTION",
    },
    outstanding_damage_amount: {
      type: Number,
      default: 0,
      min: [0, "Outstanding damage amount cannot be negative"],
    },
    deposit_settled_at: {
      type: Date,
      default: null,
    },
    deposit_settlement_snapshot: {
      type: depositSettlementSnapshotSchema,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: [
          "PENDING",
          "PAID",
          "PARTIAL_CANCEL",
          "FULLY_CANCELLED",
          "CANCEL",
        ],
        message: "{VALUE} is not a valid status",
      },
      default: "PENDING",
      required: true,
      index: true,
    },
    payment_method: {
      type: String,
      enum: {
        values: ["VNPAY", "WALLET", "HYBRID"],
        message: "{VALUE} is not a valid payment method",
      },
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
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
bookingOrderSchema.pre("save", async function () {
  // Auto-calculate final_total_price if not set
  if (
    !this.isModified("final_total_price") &&
    this.isModified("total_base_price")
  ) {
    this.final_total_price = Math.max(
      0,
      this.total_base_price - (this.total_discount || 0),
    );
  }

  // Keep payable_total_price in sync with rental + deposit
  if (
    !this.isModified("payable_total_price") &&
    (this.isModified("final_total_price") || this.isModified("deposit_total"))
  ) {
    this.payable_total_price = Math.max(
      0,
      (this.final_total_price || 0) + (this.deposit_total || 0),
    );
  }
});

// Instance method to calculate total
bookingOrderSchema.methods.calculateTotal = function () {
  this.final_total_price = Math.max(
    0,
    this.total_base_price - this.total_discount,
  );
  return this.final_total_price;
};

bookingOrderSchema.methods.calculatePayableTotal = function () {
  this.payable_total_price = Math.max(
    0,
    (this.final_total_price || 0) + (this.deposit_total || 0),
  );
  return this.payable_total_price;
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
bookingOrderSchema.methods.cancelOrder = async function ({ session } = {}) {
  if (["CANCEL", "FULLY_CANCELLED"].includes(this.status)) {
    throw new Error("Order is already cancelled");
  }

  if (!["PENDING", "PAID", "PARTIAL_CANCEL"].includes(this.status)) {
    throw new Error(`Cannot cancel order from ${this.status} status`);
  }

  this.status = this.status === "PENDING" ? "CANCEL" : "FULLY_CANCELLED";
  await this.save({ session });
  return this;
};

// Instance method to partially cancel
bookingOrderSchema.methods.partiallyCancelOrder = async function () {
  if (this.status !== "PAID") {
    throw new Error("Can only partially cancel paid orders");
  }
  this.status = "PARTIAL_CANCEL";
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
