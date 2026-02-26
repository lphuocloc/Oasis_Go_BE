const mongoose = require("mongoose");

const IndentityCardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      require: true,
    },
    qrRawData: { type: String },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    extractedInfo: {
      idNumber: { type: String, required: true },
      fullName: String,
      dob: String,
      gender: String,
      address: String,
    },
    rejectReason: { type: String },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);
const IndentityCard = mongoose.model("IndentityCard", IndentityCardSchema);

module.exports = IndentityCard;
