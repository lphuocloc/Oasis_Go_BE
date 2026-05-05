/**
 * Test Script: Replenishment Request Flow
 *
 * Bước 1: User xác nhận checklist với item MISSING/DAMAGED
 *         → POST /api/bookings/:bookingId/confirm-checklist
 *         → Tạo Incident(REPLENISHMENT_REQUEST)
 *
 * Bước 2: Cleaner bổ sung đồ
 *         → PATCH /api/incidents/:incidentId/resolve-replenishment
 *         → Trừ kho, ghi log, cộng PodItem, đóng incident
 */

require("dotenv").config();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("./src/models/User");
const Booking = require("./src/models/Bookings");
const PodItem = require("./src/models/PodItem");
const InventoryStock = require("./src/models/InventoryStock");
const Incident = require("./src/models/Incidents");
const CleaningTask = require("./src/models/CleaningTask");

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}/api`;

// ── Manual overrides (điền vào nếu muốn test với dữ liệu cụ thể) ─────────
// Để trống = script tự tìm trong DB
const MANUAL_BOOKING_ID   = "";   // Ví dụ: "abc-booking-uuid"
const MANUAL_INCIDENT_ID  = "";   // Nếu điền → bỏ qua Bước 1, test thẳng Bước 2
const MANUAL_ITEM_ID      = "";   // item_id để bổ sung (nếu trống = tự lấy từ PodItem)
const MANUAL_CLEANER_EMAIL = "";  // Email cleaner cụ thể, trống = lấy cleaner đầu tiên
// ─────────────────────────────────────────────────────────────────────────


const log = (label, data) => {
  console.log(`\n[${label}]`);
  if (typeof data === "object") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
};

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "1h" });

const callApi = async (method, path, token, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status} on ${method} ${path}`), {
      status: res.status,
      response: json,
    });
  }

  return json;
};

const runTest = async () => {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/oasisgo");
  console.log("✅ Connected to MongoDB");

  // ── Resolve actors ────────────────────────────────────────────────────────
  const cleanerQuery = MANUAL_CLEANER_EMAIL
    ? { role: "cleaner", isActive: true, email: MANUAL_CLEANER_EMAIL }
    : { role: "cleaner", isActive: true };
  const cleaner = await User.findOne(cleanerQuery).lean();
  if (!cleaner) throw new Error("No active cleaner found in DB");

  // ── Nếu có MANUAL_INCIDENT_ID → bỏ qua Bước 1 ─────────────────────────
  if (MANUAL_INCIDENT_ID) {
    const existingIncident = await Incident.findOne({ id: MANUAL_INCIDENT_ID }).lean();
    if (!existingIncident) throw new Error(`Incident ${MANUAL_INCIDENT_ID} not found`);

    const itemId = MANUAL_ITEM_ID || existingIncident.pod_id
      ? (await PodItem.findOne({ pod_id: existingIncident.pod_id }).lean())?.item_id
      : null;
    if (!itemId) throw new Error("Cannot resolve item_id for incident");

    log("ℹ️  Skipping Step 1 — using MANUAL_INCIDENT_ID", {
      incident_id: MANUAL_INCIDENT_ID,
      item_id: itemId,
    });

    // Jump to Step 2 directly
    const cleanerToken = generateToken(cleaner._id);
    const resolveBody = { items: [{ item_id: itemId, quantity: 1 }] };
    const step2Data = await callApi("PATCH", `/incidents/${MANUAL_INCIDENT_ID}/resolve-replenishment`, cleanerToken, resolveBody);
    log("✅ Replenishment resolved", step2Data);
    await mongoose.disconnect();
    return;
  }

  // User: needs an IN_USE booking with uncompleted checklist
  const bookingQuery = MANUAL_BOOKING_ID
    ? { id: MANUAL_BOOKING_ID }
    : { status: "IN_USE", is_checklist_completed: { $ne: true } };

  const booking = await Booking.findOne(bookingQuery).sort({ created_at: -1 }).lean();
  if (!booking) {
    // Fallback: find any existing PENDING replenishment incident
    const fallbackIncident = await Incident.findOne({
      incident_type: "REPLENISHMENT_REQUEST",
      $or: [
        { replenishment_status: "NOT_REPLENISHED" },
        { replenishment_status: { $exists: false } },
      ],
    }).sort({ created_at: -1 }).lean();

    if (!fallbackIncident) {
      throw new Error(
        "No IN_USE booking or existing REPLENISHMENT_REQUEST incident found.\n" +
        "Set MANUAL_BOOKING_ID or MANUAL_INCIDENT_ID at the top of the script."
      );
    }

    log("⚠️  No booking found — using existing incident", { incident_id: fallbackIncident.id });
    const itemId = MANUAL_ITEM_ID ||
      (await PodItem.findOne({ pod_id: fallbackIncident.pod_id }).lean())?.item_id;
    if (!itemId) throw new Error("Cannot resolve item_id for fallback incident");

    const cleanerToken = generateToken(cleaner._id);
    const resolveBody = { items: [{ item_id: itemId, quantity: 1 }] };
    const step2Data = await callApi("PATCH", `/incidents/${fallbackIncident.id}/resolve-replenishment`, cleanerToken, resolveBody);
    log("✅ Replenishment resolved", step2Data);
    await mongoose.disconnect();
    return;
  }

  const bookingUser = await User.findOne({
    $or: [{ _id: booking.user_id }, { id: booking.user_id }],
  }).lean();
  if (!bookingUser) throw new Error("Could not find user for booking " + booking.id);

  // Find a PodItem to report as MISSING
  const podItem = await PodItem.findOne({ pod_id: booking.pod_id }).lean();
  if (!podItem) throw new Error(`No PodItem found for pod ${booking.pod_id}`);

  // Check inventory for that item
  const stock = await InventoryStock.findOne({ item_id: podItem.item_id }).lean();
  if (!stock || stock.quantity_available < 1) {
    throw new Error(`No stock available for item ${podItem.item_id}. Please seed InventoryStock first.`);
  }

  const cleanerToken = generateToken(cleaner._id);
  const userToken = generateToken(bookingUser._id);

  log("Actors", {
    cleaner: { id: cleaner.id || String(cleaner._id), email: cleaner.email },
    user: { id: bookingUser.id || String(bookingUser._id), email: bookingUser.email },
    booking_id: booking.id,
    pod_id: booking.pod_id,
    pod_item: { item_id: podItem.item_id, expected_quantity: podItem.expected_quantity },
    stock_available: stock.quantity_available,
  });

  // ── Bước 1: User xác nhận checklist ────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Bước 1: POST /api/bookings/:id/confirm-checklist");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const checklistBody = [
    {
      item_id: podItem.item_id,
      status: "MISSING",
      quantity: 1,
    },
  ];

  let step1Data;
  try {
    step1Data = await callApi(
      "POST",
      `/bookings/${booking.id}/confirm-checklist`,
      userToken,
      checklistBody
    );
    log("✅ Checklist confirmed", {
      is_completed: step1Data.data?.is_checklist_completed,
      issue_count: step1Data.data?.issue_count,
      incidents: step1Data.data?.incidents,
    });
  } catch (err) {
    log("❌ Checklist confirm failed", err.response || err.message);
    // Fallback: find an existing REPLENISHMENT_REQUEST incident
    console.log("\n⚠️  Falling back to existing REPLENISHMENT_REQUEST incident...");
    const existingIncident = await Incident.findOne({
      incident_type: "REPLENISHMENT_REQUEST",
      replenishment_status: "NOT_REPLENISHED",
    })
      .sort({ created_at: -1 })
      .lean();

    if (!existingIncident) {
      throw new Error("No existing REPLENISHMENT_REQUEST incident found to test with.");
    }
    step1Data = { data: { incidents: [{ incident_id: existingIncident.id }] } };
    log("ℹ️  Using existing incident", { incident_id: existingIncident.id });
  }

  const incidentId = step1Data?.data?.incidents?.[0]?.incident_id;
  if (!incidentId) throw new Error("No incident_id returned from Step 1");

  // ── Bước 2: Cleaner resolve replenishment ───────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Bước 2: PATCH /api/incidents/${incidentId}/resolve-replenishment`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const resolveBody = {
    items: [
      { item_id: podItem.item_id, quantity: 1 },
    ],
  };

  const step2Data = await callApi(
    "PATCH",
    `/incidents/${incidentId}/resolve-replenishment`,
    cleanerToken,
    resolveBody
  );

  log("✅ Replenishment resolved", step2Data);

  // ── Verify: kiểm tra DB sau xử lý ──────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Verify: Kiểm tra DB sau xử lý");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const [updatedIncident, updatedStock, updatedPodItem] = await Promise.all([
    Incident.findOne({ id: incidentId }).lean(),
    InventoryStock.findOne({ id: stock.id }).lean(),
    PodItem.findOne({ pod_id: booking.pod_id, item_id: podItem.item_id }).lean(),
  ]);

  const stockDeducted = stock.quantity_available - (updatedStock?.quantity_available ?? 0);
  const podItemIncreased = (updatedPodItem?.current_quantity ?? 0) - podItem.current_quantity;

  console.log(`\n  Incident status       : ${updatedIncident?.status}`);
  console.log(`  Incident replenishment: ${updatedIncident?.replenishment_status}`);
  console.log(`  Stock before          : ${stock.quantity_available}`);
  console.log(`  Stock after           : ${updatedStock?.quantity_available}`);
  console.log(`  Stock deducted        : ${stockDeducted} ${stockDeducted === 1 ? "✅" : "❌ Expected 1"}`);
  console.log(`  PodItem before        : ${podItem.current_quantity}`);
  console.log(`  PodItem after         : ${updatedPodItem?.current_quantity}`);
  console.log(`  PodItem increased     : ${podItemIncreased} ${podItemIncreased === 1 ? "✅" : "❌ Expected 1"}`);

  const pass =
    updatedIncident?.status === "RESOLVED" &&
    updatedIncident?.replenishment_status === "REPLENISHED" &&
    stockDeducted === 1 &&
    podItemIncreased === 1;

  console.log(`\n${pass ? "🎉 ALL CHECKS PASSED!" : "❌ SOME CHECKS FAILED"}`);
};

runTest()
  .catch((err) => {
    console.error("\n❌ Test failed:", err.message);
    if (err.response) console.error("Response:", JSON.stringify(err.response, null, 2));
  })
  .finally(() => mongoose.disconnect());
