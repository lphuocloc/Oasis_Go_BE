const admin = require("firebase-admin");
const path = require("path");
// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    // Kiểm tra xem đã initialize chưa
    if (admin.apps.length === 0) {
      // Option 1: Dùng service account key file (recommended for production)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        // Dùng path.resolve để biến đường dẫn từ .env thành đường dẫn tuyệt đối
        // Tính từ gốc của dự án (process.cwd())
        const serviceAccountPath = path.resolve(
          process.cwd(),
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        );

        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log("✅ Firebase Admin initialized with service account");
      }
      // Option 2: Dùng environment variables (cho testing)
      else if (process.env.FIREBASE_PROJECT_ID) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          }),
        });
        console.log("✅ Firebase Admin initialized with environment variables");
      }
      // Option 3: Không có config - warning mode
      else {
        console.warn(
          "⚠️ Firebase credentials not configured. Google login will not work.",
        );
        return null;
      }
    }
    return admin;
  } catch (error) {
    console.error("❌ Firebase initialization error:", error);
    return null;
  }
};

// Verify Firebase ID token
const verifyFirebaseToken = async (idToken) => {
  try {
    const firebaseAdmin = initializeFirebase();
    if (!firebaseAdmin) {
      throw new Error("Firebase not initialized");
    }

    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    return {
      success: true,
      data: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture,
        emailVerified: decodedToken.email_verified,
      },
    };
  } catch (error) {
    console.error("Firebase token verification error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  initializeFirebase,
  verifyFirebaseToken,
  admin,
};
