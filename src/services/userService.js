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
}

module.exports = new UserService();
