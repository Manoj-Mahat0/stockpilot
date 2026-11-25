const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { prisma } = require("../config/prisma");
const { AppError } = require("../utils/errors");

async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new AppError("Authentication required", 401, "UNAUTHORIZED");

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new AppError("Invalid or expired token", 401, "UNAUTHORIZED");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userSites: { include: { site: true } } },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("Account inactive or not found", 401, "UNAUTHORIZED");
    }

    req.user = {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      employeeId: user.employeeId,
      canDeleteEntry: user.canDeleteEntry,
      canViewStock: user.canViewStock,
      canInward: user.canInward,
      canOutward: user.canOutward,
      canEditEntry: user.canEditEntry,
      canPrintDocs: user.canPrintDocs,
      canViewReports: user.canViewReports,
      sites: user.userSites.map((us) => us.site),
      siteIds: user.userSites.map((us) => us.siteId),
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return next(new AppError("Admin access required", 403, "FORBIDDEN"));
  }
  next();
}

function requireStaffOrAdmin(req, _res, next) {
  if (!req.user || !["ADMIN", "STAFF", "FACTORY", "SHOP"].includes(req.user.role)) {
    return next(new AppError("Access denied", 403, "FORBIDDEN"));
  }
  next();
}

function requireAnyAppUser(req, _res, next) {
  if (!req.user || !["ADMIN", "FACTORY", "SHOP", "STAFF"].includes(req.user.role)) {
    return next(new AppError("Access denied", 403, "FORBIDDEN"));
  }
  next();
}

function assertSiteAccess(user, siteId) {
  if (user.role === "ADMIN") return;
  if (!user.siteIds.includes(siteId)) {
    throw new AppError("Not assigned to this site", 403, "FORBIDDEN");
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireStaffOrAdmin,
  requireAnyAppUser,
  assertSiteAccess,
};
