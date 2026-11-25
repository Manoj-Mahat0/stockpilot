const express = require("express");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth, requireStaffOrAdmin);

router.get(
  "/current-stock",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const balances = await prisma.stockBalance.findMany({
      where: { quantity: { gt: 0 } },
      include: { product: { include: { category: true, unit: true } }, location: true },
      orderBy: [{ product: { name: "asc" } }],
    });
    res.json(balances);
  })
);

router.get(
  "/low-stock",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: { stockBalances: true, unit: true },
    });
    const rows = products
      .map((p) => {
        const qty = p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0);
        return { ...p, totalQty: qty };
      })
      .filter((p) => p.totalQty > 0 && p.totalQty <= Number(p.reorderLevel || p.minStock || 0));
    res.json(rows);
  })
);

router.get(
  "/out-of-stock",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: { stockBalances: true },
    });
    res.json(
      products
        .map((p) => ({
          ...p,
          totalQty: p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0),
        }))
        .filter((p) => p.totalQty <= 0)
    );
  })
);

router.get(
  "/stock-out",
  asyncHandler(async (req, res) => {
    const where = { status: "COMPLETED" };
    if (req.user.role !== "ADMIN") where.performedById = req.user.id;
    if (req.query.from || req.query.to) {
      where.completedAt = {};
      if (req.query.from) where.completedAt.gte = new Date(req.query.from);
      if (req.query.to) where.completedAt.lte = new Date(req.query.to);
    }
    res.json(
      await prisma.stockOutSession.findMany({
        where,
        include: {
          items: { include: { product: true, location: true } },
          performedBy: true,
        },
        orderBy: { completedAt: "desc" },
      })
    );
  })
);

router.get(
  "/stock-in",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const where = { status: "COMPLETED" };
    if (req.query.from || req.query.to) {
      where.completedAt = {};
      if (req.query.from) where.completedAt.gte = new Date(req.query.from);
      if (req.query.to) where.completedAt.lte = new Date(req.query.to);
    }
    res.json(
      await prisma.stockInSession.findMany({
        where,
        include: {
          items: { include: { product: true, location: true } },
          performedBy: true,
        },
        orderBy: { completedAt: "desc" },
      })
    );
  })
);

router.get(
  "/valuation",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const balances = await prisma.stockBalance.findMany({
      where: { quantity: { gt: 0 } },
      include: { product: true },
    });
    const rows = balances.map((b) => ({
      productId: b.productId,
      sku: b.product.sku,
      name: b.product.name,
      quantity: Number(b.quantity),
      unitCost: Number(b.product.purchasePrice),
      value: Number(b.quantity) * Number(b.product.purchasePrice),
    }));
    const total = rows.reduce((s, r) => s + r.value, 0);
    res.json({ rows, total });
  })
);

module.exports = router;
