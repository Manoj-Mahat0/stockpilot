const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const settings = await prisma.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
    res.json(settings);
  })
);

router.patch(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        companyName: z.string().optional(),
        tagline: z.string().optional(),
        warehouseLabel: z.string().optional(),
        lowStockEnabled: z.boolean().optional(),
      })
      .parse(req.body);

    const settings = await prisma.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...body },
      update: body,
    });
    res.json(settings);
  })
);

module.exports = router;
