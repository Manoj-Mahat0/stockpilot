const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { publicUser } = require("../services/authService");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const role = req.query.role;
    const users = await prisma.user.findMany({
      where: role ? { role } : undefined,
      orderBy: { createdAt: "desc" },
    });
    res.json(users.map(publicUser));
  })
);

router.get(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError("User not found", 404);
    const stockOutCount = await prisma.stockOutSession.count({
      where: { performedById: user.id, status: "COMPLETED" },
    });
    res.json({ ...publicUser(user), stockOutCount });
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
        role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
        department: z.string().optional(),
        joiningDate: z.string().optional(),
      })
      .parse(req.body);

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        employeeId: body.employeeId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: body.role,
        department: body.department,
        joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
      },
    });
    res.status(201).json(publicUser(user));
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
        joiningDate: z.string().optional().nullable(),
      })
      .parse(req.body);

    const data = { ...body };
    if (body.joiningDate) data.joiningDate = new Date(body.joiningDate);
    if (body.joiningDate === null) data.joiningDate = null;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
    });
    res.json(publicUser(user));
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

router.get(
  "/:id/stock-outs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.stockOutSession.findMany({
      where: { performedById: req.params.id, status: "COMPLETED" },
      include: { items: { include: { product: true, location: true } } },
      orderBy: { completedAt: "desc" },
      take: 100,
    });
    res.json(sessions);
  })
);

module.exports = router;
