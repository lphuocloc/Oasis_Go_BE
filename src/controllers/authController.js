const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Tạo JWT token
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: '7d'
    });
};

// @desc    Đăng ký bằng email/password
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        // Kiểm tra email đã tồn tại chưa (bất kể provider nào)
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Email already registered. Please login with your original method.',
                authProvider: existingUser.authProvider
            });
        }

        // Tạo user mới với local auth
        const user = await User.create({
            email,
            password,
            name,
            authProvider: 'local'
        });

        // Tạo token
        const token = generateToken(user._id);

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    authProvider: user.authProvider
                },
                token
            }
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
};

// @desc    Đăng nhập bằng email/password
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Tìm user theo email
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Kiểm tra authProvider
        if (user.authProvider !== 'local') {
            return res.status(403).json({
                success: false,
                message: `This email is registered with ${user.authProvider}. Please login using that method.`,
                authProvider: user.authProvider
            });
        }

        // Kiểm tra password
        const isPasswordValid = await user.comparePassword(password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Kiểm tra account có active không
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your account has been deactivated'
            });
        }

        // Tạo token
        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    authProvider: user.authProvider
                },
                token
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
};

// @desc    Đăng nhập bằng Google
// @route   POST /api/auth/google
// @access  Public
exports.googleAuth = async (req, res) => {
    try {
        const { email, googleId, name, avatar } = req.body;

        // Validate input
        if (!email || !googleId) {
            return res.status(400).json({
                success: false,
                message: 'Email and Google ID are required'
            });
        }

        // Tìm user theo email
        let user = await User.findOne({ email });

        // Case 1: Email chưa tồn tại - Tạo user mới
        if (!user) {
            user = await User.create({
                email,
                googleId,
                name,
                avatar,
                authProvider: 'google'
            });

            const token = generateToken(user._id);

            return res.status(201).json({
                success: true,
                message: 'Google authentication successful',
                isNewUser: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                        authProvider: user.authProvider
                    },
                    token
                }
            });
        }

        // Case 2: Email đã tồn tại nhưng authProvider = 'local'
        if (user.authProvider === 'local') {
            return res.status(403).json({
                success: false,
                message: 'This email is already registered with email/password. Please login using that method.',
                authProvider: user.authProvider
            });
        }

        // Case 3: Email tồn tại và authProvider = 'google'
        if (user.authProvider === 'google') {
            // Kiểm tra googleId có khớp không
            if (user.googleId !== googleId) {
                return res.status(403).json({
                    success: false,
                    message: 'Google account mismatch. This email is linked to a different Google account.'
                });
            }

            // Kiểm tra account có active không
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been deactivated'
                });
            }

            // Cập nhật thông tin nếu có thay đổi
            if (name && name !== user.name) user.name = name;
            if (avatar && avatar !== user.avatar) user.avatar = avatar;
            await user.save();

            const token = generateToken(user._id);

            return res.status(200).json({
                success: true,
                message: 'Google authentication successful',
                isNewUser: false,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                        authProvider: user.authProvider
                    },
                    token
                }
            });
        }

    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during Google authentication'
        });
    }
};

// @desc    Lấy thông tin user hiện tại
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    authProvider: user.authProvider,
                    avatar: user.avatar,
                    createdAt: user.createdAt
                }
            }
        });

    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
