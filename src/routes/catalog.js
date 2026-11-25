const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth, requireStaffOrAdmin);

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.category.findMany({ orderBy: { name: "asc" } }));
  })
);

router.post(
  "/categories",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().min(1), parentId: z.string().optional() }).parse(req.body);
    res.status(201).json(await prisma.category.create({ data: body }));
  })
);

router.get(
  "/brands",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.brand.findMany({ orderBy: { name: "asc" } }));
  })
);

router.post(
  "/brands",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    res.status(201).json(await prisma.brand.create({ data: { name } }));
  })
);

router.get(
  "/units",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.unit.findMany({ orderBy: { name: "asc" } }));
  })
);

router.post(
  "/units",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().min(1), symbol: z.string().min(1) }).parse(req.body);
    res.status(201).json(await prisma.unit.create({ data: body }));
  })
);

module.exports = router;
