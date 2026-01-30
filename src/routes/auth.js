const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User authentication and authorization endpoints
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: password123
 *               name:
 *                 type: string
 *                 example: John Doe
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Bad request - Missing or invalid fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Email and password are required
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Email already registered. Please login with your original method.
 *               authProvider: local
 */
router.post("/register", authController.register);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP to activate account
 *     description: Validates the OTP sent to user's email and activates the account. Returns JWT token upon successful verification.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address used during registration
 *                 example: user@example.com
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code received via email
 *                 minLength: 6
 *                 maxLength: 6
 *                 pattern: '^[0-9]{6}$'
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully. Account activated and JWT token issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Email verified successfully. You can now login.
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: 65a1b2c3d4e5f6789012345
 *                         email:
 *                           type: string
 *                           example: user@example.com
 *                         name:
 *                           type: string
 *                           example: John Doe
 *                         role:
 *                           type: string
 *                           example: user
 *                         authProvider:
 *                           type: string
 *                           example: local
 *                         isVerified:
 *                           type: boolean
 *                           example: true
 *                     token:
 *                       type: string
 *                       description: JWT token for authentication (expires in 7 days)
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Bad request - Validation errors or invalid OTP
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *             examples:
 *               missingFields:
 *                 summary: Missing required fields
 *                 value:
 *                   success: false
 *                   message: Email and OTP are required
 *               alreadyVerified:
 *                 summary: Email already verified
 *                 value:
 *                   success: false
 *                   message: Email already verified. Please login.
 *               noOTP:
 *                 summary: No OTP found
 *                 value:
 *                   success: false
 *                   message: No OTP found. Please request a new one.
 *               otpExpired:
 *                 summary: OTP has expired
 *                 value:
 *                   success: false
 *                   message: OTP has expired. Please request a new one.
 *               invalidOTP:
 *                 summary: Wrong OTP code
 *                 value:
 *                   success: false
 *                   message: Invalid OTP
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User not found
 *       500:
 *         description: Server error during OTP verification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Server error during OTP verification
 */
router.post("/verify-otp", authController.verifyOtp);

/**
 * @swagger
 * /api/auth/resend-otp:
 *   post:
 *     summary: Resend OTP verification code
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: OTP resent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP resent successfully. Please check your email.
 *                 data:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: string
 *                     message:
 *                       type: string
 *                     remainingAttempts:
 *                       type: number
 *       400:
 *         description: Email already verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many OTP requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Too many OTP requests. Please try again in 5 minute(s).
 */
router.post("/resend-otp", authController.resendOtp);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Bad request - Missing fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Invalid email or password
 *       403:
 *         description: Email registered with different provider
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: This email is registered with google. Please login using that method.
 *               authProvider: google
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Authenticate with Google using Firebase ID Token
 *     description: Verify Firebase ID token from Google sign-in and create/login user. Backend automatically extracts user info (email, uid, name, avatar) from the verified token.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase ID token obtained from Google authentication (JWT format). This token is verified with Firebase Admin SDK on the backend.
 *                 example: eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vbXktcHJvamVjdCIsImF1ZCI6Im15LXByb2plY3QiLCJhdXRoX3RpbWUiOjE2NDYwNjg4MDAsInVzZXJfaWQiOiJnb29nbGUtdW5pcXVlLWlkLTEyMzQ1NiIsInN1YiI6Imdvb2dsZS11bmlxdWUtaWQtMTIzNDU2IiwiaWF0IjoxNjQ2MDY4ODAwLCJleHAiOjE2NDYwNzI0MDAsImVtYWlsIjoidXNlckBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJnb29nbGUuY29tIjpbImdvb2dsZS11bmlxdWUtaWQtMTIzNDU2Il0sImVtYWlsIjpbInVzZXJAZ21haWwuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoiZ29vZ2xlLmNvbSJ9fQ.signature
 *     responses:
 *       200:
 *         description: Google authentication successful (existing user)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Google authentication successful
 *                 isNewUser:
 *                   type: boolean
 *                   example: false
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       description: JWT token (expires in 7 days)
 *       201:
 *         description: Google authentication successful (new user created)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Google authentication successful
 *                 isNewUser:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *       400:
 *         description: Bad request - Missing or invalid ID token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingToken:
 *                 value:
 *                   success: false
 *                   message: Firebase ID token is required
 *               noEmail:
 *                 value:
 *                   success: false
 *                   message: Email not found in Firebase token
 *       401:
 *         description: Invalid Firebase token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Invalid Firebase token
 *       403:
 *         description: Email registered with local auth or Google ID mismatch
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               localAuth:
 *                 value:
 *                   success: false
 *                   message: This email is already registered with email/password. Please login using that method.
 *                   authProvider: local
 *               googleMismatch:
 *                 value:
 *                   success: false
 *                   message: Google account mismatch. This email is linked to a different Google account.
 *               accountDeactivated:
 *                 value:
 *                   success: false
 *                   message: Your account has been deactivated
 */
router.post("/google", authController.googleAuth);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authorized or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               noToken:
 *                 value:
 *                   success: false
 *                   message: Not authorized. Please login to access this resource.
 *               invalidToken:
 *                 value:
 *                   success: false
 *                   message: Invalid token. Please login again.
 *               expiredToken:
 *                 value:
 *                   success: false
 *                   message: Token expired. Please login again.
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: User not found
 */
router.get("/me", protect, authController.getMe);

/**
 * @swagger
 * /api/auth/update-profile:
 * put:
 * summary: Cập nhật thông tin hồ sơ người dùng
 * description: Cho phép người dùng đã đăng nhập cập nhật tên hiển thị và ảnh đại diện.
 * tags: [Authentication]
 * security:
 * - bearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * name:
 * type: string
 * description: Tên mới của người dùng
 * example: "Nguyễn Văn A"
 * avatar:
 * type: string
 * description: URL ảnh đại diện mới hoặc chuỗi base64
 * example: "https://example.com/new-avatar.jpg"
 * responses:
 * 200:
 * description: Cập nhật hồ sơ thành công
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * success:
 * type: boolean
 * example: true
 * message:
 * type: string
 * example: Profile updated successfully
 * data:
 * type: object
 * properties:
 * user:
 * $ref: '#/components/schemas/User'
 * 401:
 * description: Không có quyền truy cập
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/Error'
 * 404:
 * description: Không tìm thấy người dùng
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/Error'
 * 500:
 * description: Lỗi hệ thống
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/Error'
 */
router.put("/update-profile", protect, authController.updateProfile);
module.exports = router;
