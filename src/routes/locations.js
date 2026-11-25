const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth, requireStaffOrAdmin);

function buildLocationCode({ roomCode, rowCode, rackCode, shelfCode, binCode }) {
  const parts = [roomCode, rowCode, rackCode, shelfCode];
  if (binCode) parts.push(binCode);
  return parts.join("-");
}

router.get(
  "/warehouse",
  asyncHandler(async (_req, res) => {
    const warehouse = await prisma.warehouse.findFirst({
      where: { isActive: true },
      include: {
        rooms: {
          include: {
            rows: {
              include: {
                racks: {
                  include: {
                    shelves: { include: { bins: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    res.json(warehouse);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const locations = await prisma.location.findMany({
      where: q
        ? {
            OR: [{ code: { contains: q } }, { barcode: { contains: q } }],
          }
        : undefined,
      include: {
        stockBalances: {
          where: { quantity: { gt: 0 } },
          include: { product: true },
        },
      },
      orderBy: { code: "asc" },
    });
    res.json(locations);
  })
);

router.get(
  "/lookup/:code",
  asyncHandler(async (req, res) => {
    const location = await prisma.location.findFirst({
      where: {
        OR: [{ code: req.params.code }, { barcode: req.params.code }],
      },
      include: {
        stockBalances: {
          where: { quantity: { gt: 0 } },
          include: { product: true },
        },
      },
    });
    if (!location) throw new AppError("Location not found", 404);
    res.json(location);
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        roomCode: z.string().min(1),
        rowCode: z.string().min(1),
        rackCode: z.string().min(1),
        shelfCode: z.string().min(1),
        binCode: z.string().optional(),
        capacity: z.number().optional(),
        status: z.enum(["ACTIVE", "BLOCKED", "INACTIVE"]).default("ACTIVE"),
      })
      .parse(req.body);

    const warehouse = await prisma.warehouse.findFirst({ where: { isActive: true } });
    if (!warehouse) throw new AppError("No active warehouse configured", 400);

    const code = buildLocationCode(body);
    const barcode = `LOC-${code}`;

    // Ensure hierarchy nodes exist
    let room = await prisma.room.findFirst({
      where: { warehouseId: warehouse.id, code: body.roomCode },
    });
    if (!room) {
      room = await prisma.room.create({
        data: { warehouseId: warehouse.id, code: body.roomCode, name: body.roomCode },
      });
    }
    let row = await prisma.row.findFirst({ where: { roomId: room.id, code: body.rowCode } });
    if (!row) {
      row = await prisma.row.create({
        data: { roomId: room.id, code: body.rowCode, name: body.rowCode },
      });
    }
    let rack = await prisma.rack.findFirst({ where: { rowId: row.id, code: body.rackCode } });
    if (!rack) {
      rack = await prisma.rack.create({
        data: { rowId: row.id, code: body.rackCode, name: body.rackCode },
      });
    }
    let shelf = await prisma.shelf.findFirst({ where: { rackId: rack.id, code: body.shelfCode } });
    if (!shelf) {
      shelf = await prisma.shelf.create({
        data: { rackId: rack.id, code: body.shelfCode, name: body.shelfCode },
      });
    }
    if (body.binCode) {
      const bin = await prisma.bin.findFirst({ where: { shelfId: shelf.id, code: body.binCode } });
      if (!bin) {
        await prisma.bin.create({
          data: { shelfId: shelf.id, code: body.binCode, name: body.binCode },
        });
      }
    }

    const location = await prisma.location.create({
      data: {
        warehouseId: warehouse.id,
        code,
        barcode,
        roomCode: body.roomCode,
        rowCode: body.rowCode,
        rackCode: body.rackCode,
        shelfCode: body.shelfCode,
        binCode: body.binCode || null,
        capacity: body.capacity,
        status: body.status,
      },
    });
    res.status(201).json(location);
  })
);

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        status: z.enum(["ACTIVE", "BLOCKED", "INACTIVE"]).optional(),
        capacity: z.number().optional().nullable(),
      })
      .parse(req.body);
    const location = await prisma.location.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(location);
  })
);

router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const stock = await prisma.stockBalance.aggregate({
      where: { locationId: req.params.id },
      _sum: { quantity: true },
    });
    if (Number(stock._sum.quantity || 0) > 0) {
      throw new AppError("Relocate stock before deleting this location", 400);
    }
    await prisma.location.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

module.exports = router;
