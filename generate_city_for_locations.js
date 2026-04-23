require('dotenv').config();
const mongoose = require('mongoose');
const NodeGeocoder = require('node-geocoder');
const Location = require('./src/models/Location');

const MONGO_URI = process.env.MONGODB_URI;
// Debug thử xem key có load được từ .env không
console.log("API key loading:", process.env.GOOGLE_MAPS_API_KEY ? "Đã thấy Key" : "Chưa thấy Key!");

const geocoder = NodeGeocoder({
    provider: 'google',
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    formatter: null
});

async function updateCities() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const locations = await Location.find({
            lat: { $ne: null },
            lng: { $ne: null },
            $or: [
                { city: { $exists: false } },
                { city: null },
                { city: '' }
            ]
        });

        console.log(`Found ${locations.length} locations to update.`);

        for (const loc of locations) {
            try {
                // SỬA LỖI: lon chứ không phải lng
                const res = await geocoder.reverse({ lat: loc.lat, lon: loc.lng });

                if (!res || res.length === 0) {
                    console.log(`No result for ${loc.name}`);
                    continue;
                }

                const data = res[0];

                // CHIẾN THUẬT LẤY CITY CHUẨN TẠI VN:
                // 1. Ưu tiên level1 (Tỉnh/Thành trung ương)
                // 2. Dự phòng bằng city/town
                let city = data.administrativeLevels?.level1long || data.city || data.state;

                // Chuẩn hóa tên Thành phố Hồ Chí Minh
                if (city && (city.includes('Ho Chi Minh') || city.includes('Hồ Chí Minh'))) {
                    city = 'Thành phố Hồ Chí Minh';
                }

                if (city) {
                    loc.city = city;
                    // Bạn có thể lưu thêm district nếu cần làm đẹp data hơn
                    // loc.district = data.administrativeLevels?.level2long || ''; 

                    await loc.save();
                    console.log(`✅ Updated ${loc.name}: city = ${city}`);
                } else {
                    console.log(`⚠️ No city found for ${loc.name}`);
                }

                // TỐI ƯU: Nghỉ 200ms để tránh bị Google coi là spam nếu danh sách quá dài
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (err) {
                // Nếu lỗi REQUEST_DENIED, script sẽ dừng hoặc báo lỗi cụ thể ở đây
                console.error(`❌ Error updating location ${loc.name}:`, err.message);
                if (err.message.includes('REQUEST_DENIED')) {
                    console.error("Dừng script: Vui lòng kiểm tra Billing hoặc Enable Geocoding API trên Google Cloud.");
                    break;
                }
            }
        }
    } catch (error) {
        console.error("Kết nối DB thất bại:", error);
    } finally {
        await mongoose.disconnect();
        console.log('Done.');
    }
}

updateCities();