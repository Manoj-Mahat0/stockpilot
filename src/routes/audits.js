const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");
const stockService = require("../services/stockService");

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.stockAudit.findMany({
        include: { createdBy: true, reviewedBy: true, _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
      })
    );
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(1),
        scope: z.enum(["FULL", "LOCATION", "PRODUCT"]).default("FULL"),
        locationId: z.string().optional(),
        productId: z.string().optional(),
      })
      .parse(req.body);

    const auditNo = await allocateDocumentNo("AUD", "AUD");
    const balances = await prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(body.locationId ? { locationId: body.locationId } : {}),
        ...(body.productId ? { productId: body.productId } : {}),
      },
    });

    const audit = await prisma.stockAudit.create({
      data: {
        auditNo,
        title: body.title,
        scope: body.scope,
        status: "IN_PROGRESS",
        createdById: req.user.id,
        items: {
          create: balances.map((b) => ({
            productId: b.productId,
            locationId: b.locationId,
            expectedQuantity: b.quantity,
          })),
        },
      },
      include: { items: true },
    });
    res.status(201).json(audit);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const audit = await prisma.stockAudit.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: true, location: true } },
        createdBy: true,
        reviewedBy: true,
      },
    });
    if (!audit) throw new AppError("Audit not found", 404);
    res.json(audit);
  })
);

router.patch(
  "/:id/items/:itemId",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        physicalQuantity: z.number().nonnegative(),
        remarks: z.string().optional(),
      })
      .parse(req.body);

    const item = await prisma.stockAuditItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.auditId !== req.params.id) throw new AppError("Item not found", 404);

    const physical = Number(body.physicalQuantity);
    const variance = physical - Number(item.expectedQuantity);

    const updated = await prisma.stockAuditItem.update({
      where: { id: item.id },
      data: {
        physicalQuantity: physical,
        variance,
        remarks: body.remarks,
      },
    });
    res.json(updated);
  })
);

router.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const audit = await prisma.stockAudit.update({
      where: { id: req.params.id },
      data: { status: "PENDING_REVIEW" },
    });
    res.json(audit);
  })
);

router.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const audit = await prisma.stockAudit.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!audit) throw new AppError("Not found", 404);
    if (audit.status !== "PENDING_REVIEW") throw new AppError("Audit not ready for approval", 400);

    for (const item of audit.items) {
      if (item.physicalQuantity == null) continue;
      const delta = Number(item.variance || 0);
      if (delta === 0) continue;
      await stockService.createAdjustment({
        productId: item.productId,
        locationId: item.locationId,
        quantityDelta: delta,
        reason: "CORRECTION",
        remarks: `Audit ${audit.auditNo}`,
        userId: req.user.id,
      });
    }

    const updated = await prisma.stockAudit.update({
      where: { id: audit.id },
      data: {
        status: "APPROVED",
        reviewedById: req.user.id,
        completedAt: new Date(),
      },
      include: { items: true },
    });
    res.json(updated);
  })
);

module.exports = router;
