const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAnyAppUser, assertSiteAccess } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { createEntry } = require("../services/entryService");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const siteId = req.query.siteId;
    const where = {};
    if (siteId) {
      assertSiteAccess(req.user, siteId);
      where.OR = [{ siteId }, { destinationSiteId: siteId }];
    } else if (req.user.role !== "ADMIN") {
      where.OR = [
        { siteId: { in: req.user.siteIds } },
        { destinationSiteId: { in: req.user.siteIds } },
      ];
    }

    const entries = await prisma.stockEntry.findMany({
      where,
      include: {
        lines: { include: { product: true } },
        site: true,
        destinationSite: true,
        performedBy: true,
        document: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(entries);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const entry = await prisma.stockEntry.findUnique({
      where: { id: req.params.id },
      include: {
        lines: { include: { product: true } },
        site: true,
        destinationSite: true,
        performedBy: true,
        document: true,
      },
    });
    if (!entry) throw new AppError("Entry not found", 404);
    assertSiteAccess(req.user, entry.siteId);
    res.json(entry);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        txnType: z.enum(["INWARD", "OUTWARD"]),
        siteId: z.string(),
        destinationSiteId: z.string().optional(),
        remarks: z.string().optional(),
        docType: z.enum(["CHALLAN", "INVOICE"]).optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerGstin: z.string().optional(),
        gstRate: z.number().nonnegative().optional(),
        lines: z
          .array(
            z.object({
              productId: z.string(),
              barcode: z.string().optional(),
              quantity: z.number().positive(),
              weight: z.number().nonnegative().optional(),
              rate: z.number().nonnegative().optional(),
              remarks: z.string().optional(),
            })
          )
          .min(1),
      })
      .parse(req.body);

    const result = await createEntry({ user: req.user, ...body });
    res.status(201).json(result);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "ADMIN" && !req.user.canDeleteEntry) {
      throw new AppError("Delete entry not permitted", 403);
    }
    const entry = await prisma.stockEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) throw new AppError("Entry not found", 404);
    assertSiteAccess(req.user, entry.siteId);
    // Soft policy: disallow hard reverse in v1 — only allow delete of mistaken records without stock reverse
    // For safety, block delete after creation; admin can mark remarks. Keep simple: only allow if created < 5 min? 
    // Plan: delete permission exists — we reverse stock for v1 completeness.
    throw new AppError("Entry delete with stock reverse coming in admin tools; contact admin to adjust stock", 400);
  })
);

module.exports = router;
