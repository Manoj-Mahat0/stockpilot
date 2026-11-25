const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");
const stockService = require("../services/stockService");

const router = express.Router();
router.use(requireAuth, requireStaffOrAdmin);

// ---- Stock In (ADMIN only) ----
router.post(
  "/in/sessions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        reference: z.string().optional(),
        remarks: z.string().optional(),
      })
      .parse(req.body || {});
    const grnNo = await allocateDocumentNo("GRN", "GRN");
    const session = await prisma.stockInSession.create({
      data: {
        grnNo,
        reference: body.reference,
        remarks: body.remarks,
        performedById: req.user.id,
      },
    });
    res.status(201).json(session);
  })
);

router.post(
  "/in/sessions/:id/items",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        locationId: z.string(),
        quantity: z.number().positive(),
        batchNo: z.string().optional(),
        expiryDate: z.string().optional(),
      })
      .parse(req.body);

    const session = await prisma.stockInSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.status !== "DRAFT") throw new AppError("Invalid draft session", 400);

    const item = await prisma.stockInItem.create({
      data: {
        sessionId: session.id,
        productId: body.productId,
        locationId: body.locationId,
        quantity: Number(body.quantity),
        batchNo: body.batchNo,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      },
      include: { product: true, location: true },
    });
    res.status(201).json(item);
  })
);

router.post(
  "/in/sessions/:id/complete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const session = await stockService.completeStockIn({
      sessionId: req.params.id,
      userId: req.user.id,
    });
    res.json(session);
  })
);

router.get(
  "/in/sessions",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.stockInSession.findMany({
        include: { items: true, performedBy: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    );
  })
);

// ---- Stock Out (ADMIN + STAFF) ----
router.post(
  "/out/sessions",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        issuedTo: z.string().optional(),
        department: z.string().optional(),
        purpose: z
          .enum([
            "INTERNAL_CONSUMPTION",
            "DEPARTMENT_ISSUE",
            "PRODUCTION",
            "SALES",
            "DISPATCH",
            "SAMPLE",
            "DAMAGED",
            "OTHER",
          ])
          .default("DEPARTMENT_ISSUE"),
        reference: z.string().optional(),
        remarks: z.string().optional(),
      })
      .parse(req.body || {});

    const issueNo = await allocateDocumentNo("ISS", "ISS");
    const session = await prisma.stockOutSession.create({
      data: {
        issueNo,
        ...body,
        performedById: req.user.id,
      },
    });
    res.status(201).json(session);
  })
);

router.post(
  "/out/sessions/:id/items",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        locationId: z.string(),
        quantity: z.number().positive(),
        batchNo: z.string().optional(),
      })
      .parse(req.body);

    const session = await prisma.stockOutSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.status !== "DRAFT") throw new AppError("Invalid draft session", 400);
    if (session.performedById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Cannot modify another user's session", 403);
    }

    const balance = await prisma.stockBalance.findFirst({
      where: {
        productId: body.productId,
        locationId: body.locationId,
        batchNo: body.batchNo || "",
      },
    });
    if (!balance || Number(balance.quantity) < body.quantity) {
      throw new AppError("Insufficient stock at selected location", 400, "INSUFFICIENT_STOCK");
    }

    const item = await prisma.stockOutItem.create({
      data: {
        sessionId: session.id,
        productId: body.productId,
        locationId: body.locationId,
        quantity: Number(body.quantity),
        batchNo: body.batchNo,
      },
      include: { product: true, location: true },
    });
    res.status(201).json(item);
  })
);

router.post(
  "/out/sessions/:id/complete",
  asyncHandler(async (req, res) => {
    const session = await prisma.stockOutSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw new AppError("Session not found", 404);
    if (session.performedById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Cannot complete another user's session", 403);
    }
    res.json(
      await stockService.completeStockOut({
        sessionId: req.params.id,
        userId: req.user.id,
      })
    );
  })
);

router.get(
  "/out/sessions",
  asyncHandler(async (req, res) => {
    const where =
      req.user.role === "ADMIN"
        ? {}
        : { performedById: req.user.id };

    res.json(
      await prisma.stockOutSession.findMany({
        where,
        include: {
          items: { include: { product: true, location: true } },
          performedBy: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    );
  })
);

router.get(
  "/out/sessions/:id",
  asyncHandler(async (req, res) => {
    const session = await prisma.stockOutSession.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: true, location: true } },
        performedBy: true,
      },
    });
    if (!session) throw new AppError("Not found", 404);
    if (req.user.role !== "ADMIN" && session.performedById !== req.user.id) {
      throw new AppError("Forbidden", 403);
    }
    res.json(session);
  })
);

// ---- Ledger ----
router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "ADMIN") {
      // Staff: only their own stock-out related ledger rows
      const rows = await prisma.stockTransaction.findMany({
        where: {
          performedById: req.user.id,
          type: "STOCK_OUT",
        },
        include: { product: true, location: true, performedBy: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return res.json(rows);
    }

    const where = {};
    if (req.query.type) where.type = req.query.type;
    if (req.query.productId) where.productId = req.query.productId;
    if (req.query.locationId) where.locationId = req.query.locationId;
    if (req.query.userId) where.performedById = req.query.userId;
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }

    const rows = await prisma.stockTransaction.findMany({
      where,
      include: { product: true, location: true, performedBy: true },
      orderBy: { createdAt: "desc" },
      take: Number(req.query.limit || 200),
    });
    res.json(rows);
  })
);

// ---- Adjustments (ADMIN) ----
router.post(
  "/adjustments",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        productId: z.string(),
        locationId: z.string(),
        quantityDelta: z.number(),
        reason: z.enum(["DAMAGED", "EXPIRED", "LOST", "FOUND", "CORRECTION", "OPENING_BALANCE"]),
        batchNo: z.string().optional(),
        remarks: z.string().optional(),
      })
      .parse(req.body);

    const adj = await stockService.createAdjustment({
      ...body,
      userId: req.user.id,
    });
    res.status(201).json(adj);
  })
);

router.get(
  "/adjustments",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.stockAdjustment.findMany({
        include: { product: true, location: true, performedBy: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    );
  })
);

module.exports = router;
