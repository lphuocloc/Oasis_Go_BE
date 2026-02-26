const jwt = require('jsonwebtoken');
const User = require('../models/user/User');

// Middleware để verify JWT và gán user vào req.user
exports.protect = async (req, res, next) => {
    try {
        let token;

        // Kiểm tra token trong Authorization header
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        // Kiểm tra token có tồn tại không
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Not authorized. Please login to access this resource.'
            });
        }

        try {
            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Tìm user từ token (không lấy password)
            const user = await User.findById(decoded.id).select('-password');

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found. Token is invalid.'
                });
            }

            // Kiểm tra account có active không
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been deactivated'
                });
            }

            // Gán user vào request
            req.user = user;
            next();

        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token. Please login again.'
                });
            }

            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token expired. Please login again.'
                });
            }

            throw error;
        }

    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authentication'
        });
    }
};

// Middleware để kiểm tra role
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role '${req.user.role}' is not authorized to access this route`
            });
        }
        next();
    };
};
