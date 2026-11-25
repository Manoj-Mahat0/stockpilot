const express = require("express");
const { z } = require("zod");
const { requireAuth, requireAnyAppUser } = require("../middleware/auth");
const { asyncHandler, AppError } = require("../utils/errors");
const { findBatchByCode, listBatches, receiveBatch } = require("../services/transferService");
const { buildBatchQrPdf } = require("../utils/batchPdf");

const router = express.Router();
router.use(requireAuth, requireAnyAppUser);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const batches = await listBatches({
      user: req.user,
      status: req.query.status || undefined,
      siteId: req.query.siteId || undefined,
    });
    res.json(batches);
  })
);

router.get(
  "/lookup/:code",
  asyncHandler(async (req, res) => {
    const batch = await findBatchByCode(req.params.code);
    if (!batch) throw new AppError("Transfer batch not found", 404, "BATCH_NOT_FOUND");

    if (req.user.role === "SHOP" && !req.user.siteIds.includes(batch.toSiteId)) {
      throw new AppError("This transfer is for a different shop", 403);
    }
    if (req.user.role === "FACTORY" && !req.user.siteIds.includes(batch.fromSiteId)) {
      throw new AppError("Not your factory batch", 403);
    }

    res.json(batch);
  })
);

router.post(
  "/receive",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().min(1),
        // Optional edits: qty/weight per product (0 = not received, never > sent)
        lines: z
          .array(
            z.object({
              productId: z.string(),
              quantity: z.number().nonnegative(),
              weight: z.number().nonnegative().optional(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const result = await receiveBatch({
      user: req.user,
      code: body.code,
      lines: body.lines,
    });
    res.status(201).json(result);
  })
);

async function sendBatchQrPdf(req, res) {
  const id = req.params.id;
  let found = await findBatchByCode(id);
  if (!found) {
    const { prisma } = require("../config/prisma");
    try {
      found = await prisma.transferBatch.findUnique({
        where: { id },
        include: { fromSite: true, toSite: true },
      });
    } catch (_) {
      found = null;
    }
  }
  if (!found) throw new AppError("Transfer batch not found", 404);

  if (req.user.role === "SHOP" && !req.user.siteIds.includes(found.toSiteId)) {
    throw new AppError("Forbidden", 403);
  }
  if (req.user.role === "FACTORY" && !req.user.siteIds.includes(found.fromSiteId)) {
    throw new AppError("Forbidden", 403);
  }

  const pdf = await buildBatchQrPdf(found);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${found.batchNo}-qr.pdf"`);
  res.send(pdf);
}

router.get("/:id/qr.pdf", asyncHandler(sendBatchQrPdf));
router.get("/:id/qr", asyncHandler(sendBatchQrPdf));

module.exports = router;
