const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { publicUser } = require("../services/authService");

const router = express.Router();

router.use(requireAuth);

const permFields = z.object({
  canDeleteEntry: z.boolean().optional(),
  canViewStock: z.boolean().optional(),
  canInward: z.boolean().optional(),
  canOutward: z.boolean().optional(),
  canEditEntry: z.boolean().optional(),
  canPrintDocs: z.boolean().optional(),
  canViewReports: z.boolean().optional(),
});

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const role = req.query.role;
    const users = await prisma.user.findMany({
      where: role ? { role } : undefined,
      include: { userSites: { include: { site: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      users.map((u) => publicUser(
        u,
        u.userSites.map((us) => us.site)
      ))
    );
  })
);

router.get(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { userSites: { include: { site: true } } },
    });
    if (!user) throw new AppError("User not found", 404);
    res.json(publicUser(user, user.userSites.map((us) => us.site)));
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        employeeId: z.string().min(1),
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        password: z.string().min(8),
        role: z.enum(["ADMIN", "FACTORY", "SHOP"]).default("SHOP"),
        department: z.string().optional(),
        siteIds: z.array(z.string()).default([]),
      })
      .merge(permFields)
      .parse(req.body);

    const passwordHash = await bcrypt.hash(body.password, 12);
    const { siteIds, password, ...rest } = body;
    const user = await prisma.user.create({
      data: {
        ...rest,
        passwordHash,
        userSites: siteIds.length
          ? { create: siteIds.map((siteId) => ({ siteId })) }
          : undefined,
      },
      include: { userSites: { include: { site: true } } },
    });
    res.status(201).json(publicUser(user, user.userSites.map((us) => us.site)));
  })
);

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional().nullable(),
        department: z.string().optional().nullable(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        role: z.enum(["ADMIN", "FACTORY", "SHOP"]).optional(),
        siteIds: z.array(z.string()).optional(),
      })
      .merge(permFields)
      .parse(req.body);

    const { siteIds, ...data } = body;

    if (siteIds) {
      await prisma.userSite.deleteMany({ where: { userId: req.params.id } });
      for (const siteId of siteIds) {
        await prisma.userSite.create({ data: { userId: req.params.id, siteId } });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      include: { userSites: { include: { site: true } } },
    });
    res.json(publicUser(user, user.userSites.map((us) => us.site)));
  })
);

router.post(
  "/:id/reset-password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash },
    });
    res.json({ ok: true });
  })
);

module.exports = router;
