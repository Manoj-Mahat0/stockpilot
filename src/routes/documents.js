const express = require("express");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAnyAppUser, assertSiteAccess, requireAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { buildDocumentPdf } = require("../utils/documentPdf");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.type) where.type = req.query.type;

    if (req.user.role === "ADMIN") {
      if (req.query.siteId) where.siteId = req.query.siteId;
    } else {
      // Own site docs (sales) OR factory challans destined to this site
      where.OR = [
        { siteId: { in: req.user.siteIds } },
        { stockEntry: { destinationSiteId: { in: req.user.siteIds } } },
      ];
    }

    const docs = await prisma.document.findMany({
      where,
      include: {
        site: true,
        createdBy: true,
        stockEntry: { include: { destinationSite: true, site: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(docs);
  })
);

async function sendProductLabelsPdf(_req, res) {
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: { barcodes: true },
    orderBy: { name: "asc" },
  });
  const labels = products
    .map((p) => {
      const bc = p.barcodes.find((b) => b.isPrimary) || p.barcodes[0];
      if (!bc) return null;
      return {
        barcodeValue: bc.value,
        productName: p.name,
        sku: p.sku,
      };
    })
    .filter(Boolean);

  const { buildLabelsPdf } = require("../utils/labelPdf");
  const pdf = await buildLabelsPdf(labels);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="product-qrcodes.pdf"');
  res.send(pdf);
}

// Support both paths (dot in filename can be awkward on some hosts)
router.get("/labels/products.pdf", requireAdmin, asyncHandler(sendProductLabelsPdf));
router.get("/labels/products", requireAdmin, asyncHandler(sendProductLabelsPdf));

router.get(
  "/:id/pdf",
  asyncHandler(async (req, res) => {
    if (req.user.role === "SHOP" && !req.user.canPrintDocs) {
      throw new AppError("Print not permitted", 403);
    }
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        createdBy: true,
        stockEntry: { include: { destinationSite: true, site: true } },
      },
    });
    if (!doc) throw new AppError("Document not found", 404);
    assertSiteAccess(req.user, doc.siteId);

    const pdf = await buildDocumentPdf(doc);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.docNo}.pdf"`);
    res.send(pdf);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { site: true, createdBy: true, stockEntry: { include: { destinationSite: true } } },
    });
    if (!doc) throw new AppError("Document not found", 404);
    assertSiteAccess(req.user, doc.siteId);
    res.json(doc);
  })
);

module.exports = router;
