require("dotenv").config();
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const cleaningTaskService = require("./src/services/cleaningTaskService");
const supportRequestService = require("./src/services/supportRequestService");
const bookingService = require("./src/services/bookingService");

const Booking = require("./src/models/Bookings");
const Pod = require("./src/models/Pod");
const User = require("./src/models/User");
const CleaningTask = require("./src/models/CleaningTask");
const OnlineKey = require("./src/models/OnlineKey");

async function runTest() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/oasisgo");
        console.log("Connected to DB");

        // 1. Fetch random dummy data to satisfy relations
        let cleaner = await User.findOne({ email: "testcleaner@dev.null" });
        if (!cleaner) {
            cleaner = await User.create({
                id: uuidv4(),
                email: "testcleaner@dev.null",
                password: "testpassword",
                phone: "+84999999991",
                role: "cleaner",
                status: "ACTIVE"
            });
        }

        let customer = await User.findOne({ email: "testcustomer@dev.null" });
        if (!customer) {
            customer = await User.create({
                id: uuidv4(),
                email: "testcustomer@dev.null",
                password: "testpassword",
                phone: "+84999999992",
                role: "user",
                status: "ACTIVE"
            });
        }

        const pods = await Pod.find({ status: "AVAILABLE" }).limit(2);
        if (pods.length < 2) {
            // Create pods if none exist
            const newPod1 = await Pod.create({
                id: uuidv4(), cluster_id: uuidv4(), code: "P_" + Math.random(), name: "Mock Pod A"
            });
            const newPod2 = await Pod.create({
                id: uuidv4(), cluster_id: uuidv4(), code: "P_" + Math.random(), name: "Mock Pod B"
            });
            pods.push(newPod1, newPod2);
        }
        const [oldPod, newPod] = pods;

        console.log(`Using Old Pod: ${oldPod.code}, New Pod: ${newPod.code}`);
        console.log(`Using Cleaner ID: ${cleaner.id}`);

        // 2. Create the Booking mimicking IN_USE
        const booking = new Booking({
            id: uuidv4(),
            user_id: customer ? customer.id : uuidv4(),
            pod_id: oldPod.id,
            start_time: new Date(Date.now() - 3600000), // 1 hour ago
            end_time: new Date(Date.now() + 3600000),   // 1 hour later
            status: "IN_USE",
            checkin_state: "PENDING",
            cleaner_access_allowed: true, // User allowed cleaner
            total_price: 100000,
            base_price: 100000,
            order_id: uuidv4()
        });
        await booking.save();
        console.log(`Created Booking: ${booking.id} at Old Pod: ${oldPod.id}`);

        // 3. Mimic Support Request room change (just the OnlineKey and DB part to avoid full payload checks)
        console.log("--- Executing room change ---");
        booking.pod_id = newPod.id;
        await booking.save();

        console.log("=========================================");
        console.log("SCENARIO 1: Cleaner gets key for OLD POD");
        console.log("=========================================");
        const oldPodTask = new CleaningTask({
            id: uuidv4(),
            booking_id: booking.id,
            pod_id: oldPod.id,
            cleaner_id: cleaner.id,
            status: "ASSIGNED",
            request_source: "ROOM_CHANGE_VACATED",
            due_at: new Date(Date.now() + 3000000)
        });
        await oldPodTask.save();

        // Call the exact service method logic for old task
        await cleaningTaskService.getMyCleanerKeyByTaskId(oldPodTask.id, { id: cleaner.id, role: "cleaner" });

        let keys = await OnlineKey.find({ booking_id: booking.id });
        console.log(`Current keys after OLD POD task (Total: ${keys.length}):`);
        keys.forEach(k => console.log(`  - Type: ${k.key_type}, Pod: ${k.pod_id === oldPod.id ? 'OLD' : 'NEW'} (${k.pod_id}), Key: ${k.key_token}, Revoked: ${k.is_revoked}`));

        console.log("\n=========================================");
        console.log("SCENARIO 2: Booking completes (Checkout)");
        console.log("=========================================");
        booking.status = "COMPLETED";
        await booking.save();

        const newPodTask = new CleaningTask({
            id: uuidv4(),
            booking_id: booking.id,
            pod_id: newPod.id,
            cleaner_id: cleaner.id,
            status: "ASSIGNED",
            request_source: "ROOM_CHANGE_VACATED",
            due_at: new Date(Date.now() + 3000000)
        });
        await newPodTask.save();

        // Call the exact service method logic for new task
        await cleaningTaskService.getMyCleanerKeyByTaskId(newPodTask.id, { id: cleaner.id, role: "cleaner" });

        keys = await OnlineKey.find({ booking_id: booking.id });
        console.log(`Current keys after NEW POD task (Total: ${keys.length}):`);
        keys.forEach(k => console.log(`  - Type: ${k.key_type}, Pod: ${k.pod_id === oldPod.id ? 'OLD' : 'NEW'} (${k.pod_id}), Key: ${k.key_token}, Revoked: ${k.is_revoked}`));

        // Clean up
        await Booking.deleteOne({ id: booking.id });
        await CleaningTask.deleteMany({ booking_id: booking.id });
        await OnlineKey.deleteMany({ booking_id: booking.id });

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        process.exit(0);
    }
}

runTest();
