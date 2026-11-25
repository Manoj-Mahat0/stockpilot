const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/prisma");
const { requireAuth, requireAdmin, requireAnyAppUser } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    // Admins see all; factory users may list shops as outward destinations
    if (req.user.role === "ADMIN" || (req.user.role === "FACTORY" && type === "SHOP")) {
      const sites = await prisma.site.findMany({
        where: {
          isActive: true,
          ...(type ? { type } : {}),
        },
        orderBy: { name: "asc" },
      });
      return res.json(sites);
    }
    let mine = req.user.sites.filter((s) => s.isActive !== false);
    if (type) mine = mine.filter((s) => s.type === type);
    res.json(mine);
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.enum(["FACTORY", "SHOP"]),
        address: z.string().optional(),
      })
      .parse(req.body);

    const site = await prisma.site.create({ data: body });
    res.status(201).json(site);
  })
);

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().optional(),
        address: z.string().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);

    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(site);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError("Site not found", 404);
    if (req.user.role !== "ADMIN" && !req.user.siteIds.includes(site.id)) {
      throw new AppError("Not assigned to this site", 403);
    }
    res.json(site);
  })
);

module.exports = router;
