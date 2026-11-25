const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/prisma");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");

function publicUser(user) {
  return {
    id: user.id,
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    department: user.department,
    joiningDate: user.joiningDate,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

async function createRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });
  return token;
}

async function login({ identifier, password, expectedRole }) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { employeeId: identifier }],
    },
  });

  if (!user) throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  if (user.status !== "ACTIVE") throw new AppError("Account is inactive", 403, "INACTIVE");

  if (expectedRole && user.role !== expectedRole) {
    throw new AppError(`Please sign in as ${user.role === "ADMIN" ? "Admin" : "Staff"}`, 403, "ROLE_MISMATCH");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
    },
  });

  return {
    user: publicUser(user),
    accessToken,
    refreshToken,
  };
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("User not found", 404);
  return publicUser(user);
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("User not found", 404);
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new AppError("Current password is incorrect", 400);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { ok: true };
}

async function refresh(refreshToken) {
  const row = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });
  if (!row || row.expiresAt < new Date()) {
    throw new AppError("Invalid refresh token", 401);
  }
  if (row.user.status !== "ACTIVE") throw new AppError("Account inactive", 403);
  return {
    accessToken: signAccessToken(row.user),
    user: publicUser(row.user),
  };
}

async function logout(refreshToken) {
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
  return { ok: true };
}

module.exports = {
  login,
  me,
  changePassword,
  refresh,
  logout,
  publicUser,
  signAccessToken,
};
