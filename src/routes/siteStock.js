const express = require("express");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAnyAppUser, assertSiteAccess } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const siteId = req.query.siteId;
    if (!siteId) throw new AppError("siteId required", 400);
    assertSiteAccess(req.user, siteId);

    if (req.user.role === "SHOP" && !req.user.canViewStock) {
      throw new AppError("View stock not permitted", 403);
    }

    const rows = await prisma.siteStock.findMany({
      where: { siteId, OR: [{ quantity: { gt: 0 } }, { weight: { gt: 0 } }] },
      include: { product: { include: { barcodes: true, unit: true } }, site: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json(rows);
  })
);

/** Admin: full inventory across factory + all shops */
router.get(
  "/all",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "ADMIN") {
      throw new AppError("Admin only", 403);
    }

    const sites = await prisma.site.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    const stocks = await prisma.siteStock.findMany({
      where: { OR: [{ quantity: { gt: 0 } }, { weight: { gt: 0 } }] },
      include: { product: { include: { barcodes: true } }, site: true },
      orderBy: { updatedAt: "desc" },
    });

    const bySite = sites.map((site) => {
      const rows = stocks.filter((s) => s.siteId === site.id);
      const totalQty = rows.reduce((a, r) => a + Number(r.quantity), 0);
      const totalWeight = rows.reduce((a, r) => a + Number(r.weight), 0);
      return {
        site,
        totalQty,
        totalWeight,
        skuCount: rows.length,
        rows,
      };
    });

    res.json({ sites: bySite });
  })
);

module.exports = router;
