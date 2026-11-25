const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth);

router.get(
  "/",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const barcodes = await prisma.productBarcode.findMany({
      where: q
        ? {
            OR: [
              { value: { contains: q } },
              { product: { name: { contains: q } } },
              { product: { sku: { contains: q } } },
            ],
          }
        : undefined,
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(barcodes);
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        value: z.string().min(1),
        symbology: z.enum(["CODE128", "EAN13", "UPCA", "QR"]).default("CODE128"),
        isPrimary: z.boolean().default(false),
      })
      .parse(req.body);

    if (body.isPrimary) {
      await prisma.productBarcode.updateMany({
        where: { productId: body.productId },
        data: { isPrimary: false },
      });
    }

    const barcode = await prisma.productBarcode.create({ data: body, include: { product: true } });
    res.status(201).json(barcode);
  })
);

router.post(
  "/generate",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        symbology: z.enum(["CODE128", "EAN13", "UPCA", "QR"]).default("CODE128"),
      })
      .parse(req.body);

    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) throw new AppError("Product not found", 404);

    let value;
    if (body.symbology === "EAN13") {
      const base = String(Date.now()).slice(-12);
      value = base + ean13CheckDigit(base);
    } else if (body.symbology === "UPCA") {
      const base = String(Date.now()).slice(-11);
      value = base + upcCheckDigit(base);
    } else {
      value = `SP-${product.sku}-${Date.now().toString().slice(-6)}`;
    }

    const barcode = await prisma.productBarcode.create({
      data: {
        productId: product.id,
        value,
        symbology: body.symbology,
        isPrimary: true,
      },
      include: { product: true },
    });
    res.status(201).json(barcode);
  })
);

function ean13CheckDigit(digits12) {
  const d = digits12.split("").map(Number);
  const sum = d.reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

function upcCheckDigit(digits11) {
  const d = digits11.split("").map(Number);
  const sum = d.reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

module.exports = router;
