const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { generateProductBarcode } = require("../utils/barcode");

const router = express.Router();
router.use(requireAuth, requireStaffOrAdmin);

function num(v) {
  return v === undefined || v === null ? undefined : Number(v);
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const products = await prisma.product.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { barcodes: { some: { value: { contains: q } } } },
            ],
          }
        : undefined,
      include: {
        category: true,
        brand: true,
        unit: true,
        barcodes: true,
        stockBalances: true,
      },
      orderBy: { name: "asc" },
    });

    res.json(
      products.map((p) => ({
        ...p,
        totalQty: p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0),
      }))
    );
  })
);

router.get(
  "/lookup/:code",
  asyncHandler(async (req, res) => {
    const code = req.params.code;
    const siteId = req.query.siteId;
    const product = await prisma.product.findFirst({
      where: {
        OR: [{ sku: code }, { barcodes: { some: { value: code } } }],
      },
      include: {
        category: true,
        brand: true,
        unit: true,
        barcodes: true,
        stockBalances: { include: { location: true } },
        siteStocks: siteId ? { where: { siteId }, include: { site: true } } : { include: { site: true } },
      },
    });
    if (!product) throw new AppError("Product not found for barcode/SKU", 404);
    const siteStock = siteId
      ? product.siteStocks.find((s) => s.siteId === siteId) || null
      : null;
    res.json({
      ...product,
      totalQty: product.stockBalances.reduce((s, b) => s + Number(b.quantity), 0),
      siteQty: siteStock ? Number(siteStock.quantity) : null,
      siteWeight: siteStock ? Number(siteStock.weight) : null,
      siteStock,
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        brand: true,
        unit: true,
        barcodes: true,
        stockBalances: { include: { location: true } },
      },
    });
    if (!product) throw new AppError("Product not found", 404);
    res.json({
      ...product,
      totalQty: product.stockBalances.reduce((s, b) => s + Number(b.quantity), 0),
    });
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        sku: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        categoryId: z.string().optional().nullable(),
        brandId: z.string().optional().nullable(),
        unitId: z.string().optional().nullable(),
        purchasePrice: z.number().nonnegative().default(0),
        sellingPrice: z.number().nonnegative().default(0),
        minStock: z.number().nonnegative().default(0),
        reorderLevel: z.number().nonnegative().default(0),
        maxStock: z.number().nonnegative().optional().nullable(),
        trackBatch: z.boolean().default(false),
        trackExpiry: z.boolean().default(false),
        trackSerial: z.boolean().default(false),
        barcode: z.string().optional(),
        symbology: z.enum(["CODE128", "EAN13", "UPCA", "QR"]).default("QR"),
      })
      .parse(req.body);

    // Every product always gets a barcode (auto-generated if not provided)
    let barcodeValue = (body.barcode || "").trim() || generateProductBarcode(body.sku);
    // Ensure uniqueness
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.productBarcode.findUnique({ where: { value: barcodeValue } });
      if (!exists) break;
      barcodeValue = generateProductBarcode(`${body.sku}${i + 1}`);
    }

    const product = await prisma.product.create({
      data: {
        sku: body.sku,
        name: body.name,
        description: body.description,
        categoryId: body.categoryId || null,
        brandId: body.brandId || null,
        unitId: body.unitId || null,
        purchasePrice: num(body.purchasePrice),
        sellingPrice: num(body.sellingPrice),
        minStock: num(body.minStock),
        reorderLevel: num(body.reorderLevel),
        maxStock: body.maxStock != null ? num(body.maxStock) : null,
        trackBatch: body.trackBatch,
        trackExpiry: body.trackExpiry,
        trackSerial: body.trackSerial,
        barcodes: {
          create: {
            value: barcodeValue,
            symbology: body.symbology || "QR",
            isPrimary: true,
          },
        },
      },
      include: { barcodes: true, category: true, brand: true, unit: true },
    });
    res.status(201).json(product);
  })
);

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        categoryId: z.string().optional().nullable(),
        brandId: z.string().optional().nullable(),
        unitId: z.string().optional().nullable(),
        purchasePrice: z.number().nonnegative().optional(),
        sellingPrice: z.number().nonnegative().optional(),
        minStock: z.number().nonnegative().optional(),
        reorderLevel: z.number().nonnegative().optional(),
        maxStock: z.number().nonnegative().optional().nullable(),
        trackBatch: z.boolean().optional(),
        trackExpiry: z.boolean().optional(),
        trackSerial: z.boolean().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        imageUrl: z.string().optional().nullable(),
      })
      .parse(req.body);

    const data = { ...body };
    ["purchasePrice", "sellingPrice", "minStock", "reorderLevel", "maxStock"].forEach((k) => {
      if (body[k] !== undefined) data[k] = body[k] === null ? null : num(body[k]);
    });

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { barcodes: true, category: true, brand: true, unit: true },
    });
    res.json(product);
  })
);

router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const balances = await prisma.stockBalance.aggregate({
      where: { productId: req.params.id },
      _sum: { quantity: true },
    });
    if (Number(balances._sum.quantity || 0) > 0) {
      throw new AppError("Cannot delete product with remaining stock", 400);
    }
    await prisma.product.update({
      where: { id: req.params.id },
      data: { status: "INACTIVE" },
    });
    res.json({ ok: true });
  })
);

module.exports = router;
