const express = require("express");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get(
  "/admin",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const today = startOfToday();

    const [
      totalProducts,
      balances,
      todayIn,
      todayOut,
      activeStaff,
      pendingAudits,
      recentTx,
      categories,
    ] = await Promise.all([
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.stockBalance.findMany({ include: { product: true } }),
      prisma.stockTransaction.aggregate({
        where: { type: "STOCK_IN", createdAt: { gte: today } },
        _sum: { quantityIn: true },
      }),
      prisma.stockTransaction.aggregate({
        where: { type: "STOCK_OUT", createdAt: { gte: today } },
        _sum: { quantityOut: true },
      }),
      prisma.user.count({ where: { role: "STAFF", status: "ACTIVE" } }),
      prisma.stockAudit.count({
        where: { status: { in: ["IN_PROGRESS", "PENDING_REVIEW"] } },
      }),
      prisma.stockTransaction.findMany({
        include: { product: true, location: true, performedBy: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.category.findMany({
        include: { _count: { select: { products: true } } },
      }),
    ]);

    let totalQty = 0;
    let inventoryValue = 0;
    let lowStock = 0;
    let outOfStock = 0;

    const byProduct = new Map();
    for (const b of balances) {
      const qty = Number(b.quantity);
      totalQty += qty;
      inventoryValue += qty * Number(b.product.purchasePrice || 0);
      byProduct.set(b.productId, (byProduct.get(b.productId) || 0) + qty);
    }

    const products = await prisma.product.findMany({ where: { status: "ACTIVE" } });
    for (const p of products) {
      const qty = byProduct.get(p.id) || 0;
      if (qty <= 0) outOfStock += 1;
      else if (qty <= Number(p.reorderLevel || p.minStock || 0)) lowStock += 1;
    }

    // Monthly in/out (last 6 months)
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const from = new Date();
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      from.setMonth(from.getMonth() - i);
      const to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      const [inn, out] = await Promise.all([
        prisma.stockTransaction.aggregate({
          where: { type: "STOCK_IN", createdAt: { gte: from, lt: to } },
          _sum: { quantityIn: true },
        }),
        prisma.stockTransaction.aggregate({
          where: { type: "STOCK_OUT", createdAt: { gte: from, lt: to } },
          _sum: { quantityOut: true },
        }),
      ]);
      months.push({
        month: from.toLocaleString("en", { month: "short" }),
        stockIn: Number(inn._sum.quantityIn || 0),
        stockOut: Number(out._sum.quantityOut || 0),
      });
    }

    res.json({
      kpis: {
        totalProducts,
        totalQty,
        inventoryValue,
        todayStockIn: Number(todayIn._sum.quantityIn || 0),
        todayStockOut: Number(todayOut._sum.quantityOut || 0),
        lowStock,
        outOfStock,
        activeStaff,
        pendingAudits,
      },
      monthly: months,
      categories: categories.map((c) => ({
        name: c.name,
        count: c._count.products,
      })),
      recentTransactions: recentTx,
    });
  })
);

router.get(
  "/staff",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const today = startOfToday();
    const userId = req.user.id;

    const [todaySessions, recent] = await Promise.all([
      prisma.stockOutSession.findMany({
        where: {
          performedById: userId,
          status: "COMPLETED",
          completedAt: { gte: today },
        },
        include: { items: true },
      }),
      prisma.stockOutSession.findMany({
        where: { performedById: userId, status: "COMPLETED" },
        include: { items: { include: { product: true, location: true } } },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
    ]);

    let todayItems = 0;
    let todayQty = 0;
    for (const s of todaySessions) {
      todayItems += s.items.length;
      todayQty += s.items.reduce((a, i) => a + Number(i.quantity), 0);
    }

    res.json({
      kpis: {
        todayIssuedItems: todayItems,
        todayIssuedQty: todayQty,
        recentCount: recent.length,
      },
      recent,
    });
  })
);

module.exports = router;
