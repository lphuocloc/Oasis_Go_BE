const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = require("../src/config/db");
const User = require("../src/models/User");
const IdentityCard = require("../src/models/cccd/IndentityCard");

const hasFlag = (flag) => process.argv.includes(flag);

const buildIdNumber = (index) => {
    const suffix = String(100000000 + index).slice(-9);
    return `036${suffix}`;
};

const buildIdentityInfo = (user, index) => {
    const fullName = (user.name || `USER ${index + 1}`).toUpperCase();
    const year = 1990 + (index % 20);
    const dob = `01/01/${year}`;
    const gender = index % 2 === 0 ? "Nam" : "Nu";
    const address = "Ha Noi";

    return {
        idNumber: buildIdNumber(index),
        fullName,
        dob,
        gender,
        address,
    };
};

const buildQrRawData = (info) =>
    `${info.idNumber}|${info.fullName}|${info.dob}|${info.gender}|${info.address}`;

const run = async () => {
    const force = hasFlag("--force");

    await connectDB();

    const users = await User.find({}).sort({ createdAt: 1 });
    const existingNumbers = await IdentityCard.find({
        "extractedInfo.idNumber": { $ne: null },
    })
        .select("extractedInfo.idNumber")
        .lean();

    const usedNumbers = new Set(
        existingNumbers
            .map((card) => card.extractedInfo && card.extractedInfo.idNumber)
            .filter(Boolean),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < users.length; i += 1) {
        const user = users[i];
        let identity = await IdentityCard.findOne({ userId: user._id });

        if (identity && identity.extractedInfo?.idNumber && !force) {
            if (!user.identityCard || String(user.identityCard) !== String(identity._id)) {
                await User.findByIdAndUpdate(user._id, { identityCard: identity._id });
            }
            skipped += 1;
            continue;
        }

        let info = buildIdentityInfo(user, i);
        let guard = 0;
        while (usedNumbers.has(info.idNumber)) {
            guard += 1;
            info = buildIdentityInfo(user, i + guard);
        }
        usedNumbers.add(info.idNumber);

        const payload = {
            userId: user._id,
            qrRawData: buildQrRawData(info),
            extractedInfo: info,
            status: "verified",
            verifiedAt: new Date(),
        };

        if (identity) {
            identity = await IdentityCard.findOneAndUpdate(
                { _id: identity._id },
                payload,
                { new: true },
            );
            updated += 1;
        } else {
            identity = await IdentityCard.create(payload);
            created += 1;
        }

        if (!user.identityCard || String(user.identityCard) !== String(identity._id)) {
            await User.findByIdAndUpdate(user._id, { identityCard: identity._id });
        }
    }

    console.log(
        `Seed CCCD done. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`,
    );
};

run()
    .catch((error) => {
        console.error("Seed CCCD failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
