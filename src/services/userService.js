const User = require("../models/User");

class UserService {
  normalizeRole(role) {
    if (role === undefined || role === null || role === "") {
      return "user";
    }

    const normalizedRole = String(role).trim().toLowerCase();
    const allowedRoles = ["user", "admin", "manager", "cleaner"];

    if (!allowedRoles.includes(normalizedRole)) {
      const error = new Error("Invalid role query. Allowed values: user, admin, manager, cleaner");
      error.statusCode = 400;
      throw error;
    }

    return normalizedRole;
  }

  parseRoleFilter(role) {
    if (role === undefined || role === null || role === "") {
      return null;
    }

    const normalizedRole = String(role).trim().toLowerCase();
    const allowedRoles = ["user", "admin", "manager", "cleaner"];

    if (!allowedRoles.includes(normalizedRole)) {
      const error = new Error(
        "Invalid role query. Allowed values: user, admin, manager, cleaner",
      );
      error.statusCode = 400;
      throw error;
    }

    return normalizedRole;
  }

  parseIsActiveFilter(isActive) {
    if (isActive === undefined || isActive === null || isActive === "") {
      return null;
    }

    const normalizedValue = String(isActive).trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }

    const error = new Error("Invalid isActive query. Allowed values: true, false");
    error.statusCode = 400;
    throw error;
  }

  async getActiveUsers(role) {
    const query = { isActive: true };

    query.role = this.normalizeRole(role);

    return User.find(query, {
      _id: 1,
      id: 1,
      name: 1,
      email: 1,
      phone: 1,
      avatar: 1,
      role: 1,
      isActive: 1,
      createdAt: 1,
    }).lean();
  }

  async createUser(userData) {
    const { email, password, name, phone, role } = userData;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("Người dùng với email này đã tồn tại");
      error.statusCode = 400;
      throw error;
    }

    const user = new User({
      email,
      password,
      name,
      phone,
      role: this.normalizeRole(role),
      isActive: true,
      authProvider: "local",
    });

    await user.save();
    return user;
  }

  async getAllUsersForAdmin({ role, isActive } = {}) {
    const query = {};

    const roleFilter = this.parseRoleFilter(role);
    const isActiveFilter = this.parseIsActiveFilter(isActive);

    if (roleFilter) {
      query.role = roleFilter;
    }

    if (isActiveFilter !== null) {
      query.isActive = isActiveFilter;
    }

    return User.find(query, {
      _id: 1,
      id: 1,
      name: 1,
      email: 1,
      phone: 1,
      avatar: 1,
      role: 1,
      isActive: 1,
      createdAt: 1,
      authProvider: 1,
      isVerified: 1,
    }).lean();
  }

  async getUserDetailForAdmin(userId) {
    const user = await User.findById(userId).populate({
      path: "identityCard",
      select: "extractedInfo status verifiedAt rejectReason",
    });

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    return {
      id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      bank_name: user.bank_name,
      bank_account_number: user.bank_account_number,
      role: user.role,
      authProvider: user.authProvider,
      avatar: user.avatar,
      profilePicture: user.profilePicture,
      isVerified: user.isVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      cccd: user.identityCard?.extractedInfo || null,
      identityCardStatus: user.identityCard?.status || "unverified",
      identityCardVerifiedAt: user.identityCard?.verifiedAt || null,
      identityCardRejectReason: user.identityCard?.rejectReason || null,
    };
  }

  async updateUser(userId, updateData) {
    const user = await User.findOne({ id: userId });
    if (!user) {
      const error = new Error("Không tìm thấy người dùng");
      error.statusCode = 404;
      throw error;
    }

    if (updateData.name) user.name = updateData.name;
    if (updateData.phone) user.phone = updateData.phone;
    if (updateData.role) user.role = this.normalizeRole(updateData.role);
    if (updateData.isActive !== undefined) user.isActive = updateData.isActive;
    if (updateData.password) user.password = updateData.password;

    await user.save();
    return user;
  }
}

module.exports = new UserService();
