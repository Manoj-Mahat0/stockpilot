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

module.exports = router;
