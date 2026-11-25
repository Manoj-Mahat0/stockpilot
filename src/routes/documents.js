const express = require("express");
const PDFDocument = require("pdfkit");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAnyAppUser, assertSiteAccess, requireAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { buildLabelsPdf } = require("../utils/labelPdf");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.type) where.type = req.query.type;
    if (req.user.role !== "ADMIN") {
      where.siteId = { in: req.user.siteIds };
    } else if (req.query.siteId) {
      where.siteId = req.query.siteId;
    }

    const docs = await prisma.document.findMany({
      where,
      include: { site: true, createdBy: true, stockEntry: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(docs);
  })
);

router.get(
  "/labels/products.pdf",
  requireAdmin,
  asyncHandler(async (_req, res) => {
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

    const pdf = await buildLabelsPdf(labels);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="product-barcodes.pdf"');
    res.send(pdf);
  })
);

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

async function buildDocumentPdf(doc) {
  const chunks = [];
  const pdf = new PDFDocument({ size: "A4", margin: 48 });
  pdf.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));

  const title = doc.type === "INVOICE" ? "TAX INVOICE" : "DELIVERY CHALLAN";
  pdf.fontSize(18).fillColor("#001637").text("STOCKPILOT", { align: "left" });
  pdf.fontSize(14).text(title);
  pdf.moveDown(0.5);
  pdf.fontSize(10).fillColor("#000");
  pdf.text(`Document No: ${doc.docNo}`);
  pdf.text(`Date: ${new Date(doc.createdAt).toLocaleString()}`);
  pdf.text(`Site: ${doc.site?.name || ""} (${doc.site?.code || ""})`);
  if (doc.stockEntry?.destinationSite) {
    pdf.text(
      `Destination: ${doc.stockEntry.destinationSite.name} (${doc.stockEntry.destinationSite.code})`
    );
  }
  if (doc.type === "INVOICE") {
    pdf.text(`Customer: ${doc.customerName || "—"}`);
    if (doc.customerPhone) pdf.text(`Phone: ${doc.customerPhone}`);
    if (doc.customerGstin) pdf.text(`GSTIN: ${doc.customerGstin}`);
  }
  pdf.moveDown();

  const lines = Array.isArray(doc.lineSnapshot) ? doc.lineSnapshot : [];
  pdf.fontSize(11).text("Items", { underline: true });
  pdf.moveDown(0.3);
  pdf.fontSize(9);
  lines.forEach((l, i) => {
    pdf.text(
      `${i + 1}. ${l.name || ""} [${l.sku || ""}]  Qty: ${l.quantity}  Wt: ${l.weight || 0}` +
        (doc.type === "INVOICE" ? `  Rate: ${l.rate || 0}  Amt: ${l.amount || 0}` : "")
    );
  });

  if (doc.type === "INVOICE") {
    pdf.moveDown();
    pdf.text(`Subtotal: ${doc.subtotal}`);
    pdf.text(`GST (${doc.gstRate}%): ${doc.gstAmount}`);
    pdf.fontSize(11).text(`Total: ${doc.totalAmount}`);
  }

  if (doc.remarks) {
    pdf.moveDown();
    pdf.fontSize(9).text(`Remarks: ${doc.remarks}`);
  }

  pdf.moveDown(2);
  pdf.text("Authorised Signature: ____________________");

  pdf.end();
  return done;
}

module.exports = router;
