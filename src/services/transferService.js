const { prisma } = require("../config/prisma");
const { AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");
const { applyDelta } = require("./entryService");

function normalizeBatchCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

async function findBatchByCode(code) {
  const raw = String(code || "").trim();
  const upper = normalizeBatchCode(code);
  return prisma.transferBatch.findFirst({
    where: {
      OR: [{ qrValue: raw }, { qrValue: upper }, { batchNo: raw }, { batchNo: upper }],
    },
    include: {
      fromSite: true,
      toSite: true,
      createdBy: { select: { id: true, name: true, employeeId: true } },
      receivedBy: { select: { id: true, name: true, employeeId: true } },
    },
  });
}

async function listBatches({ user, status, siteId }) {
  const where = {};
  if (status) where.status = status;

  if (user.role === "ADMIN") {
    if (siteId) {
      where.OR = [{ fromSiteId: siteId }, { toSiteId: siteId }];
    }
  } else if (user.role === "FACTORY") {
    where.fromSiteId = { in: user.siteIds };
  } else if (user.role === "SHOP") {
    where.toSiteId = { in: user.siteIds };
  }

  return prisma.transferBatch.findMany({
    where,
    include: {
      fromSite: true,
      toSite: true,
      createdBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/**
 * Shop (or admin) receives a PENDING factory transfer.
 * Quantities are locked to the batch snapshot — cannot receive more/less.
 */
async function receiveBatch({ user, code }) {
  const batch = await findBatchByCode(code);
  if (!batch) throw new AppError("Transfer batch not found", 404, "BATCH_NOT_FOUND");
  if (batch.status === "RECEIVED") {
    throw new AppError("This batch was already received", 400, "BATCH_ALREADY_RECEIVED");
  }
  if (batch.status !== "PENDING") {
    throw new AppError(`Batch status is ${batch.status}`, 400, "BATCH_NOT_PENDING");
  }

  if (user.role !== "ADMIN" && !user.siteIds.includes(batch.toSiteId)) {
    throw new AppError("This transfer is for a different shop", 403);
  }
  if (user.role === "SHOP" && !user.canInward) {
    throw new AppError("Inward not permitted", 403);
  }

  const lines = Array.isArray(batch.lineSnapshot) ? batch.lineSnapshot : [];
  if (!lines.length) throw new AppError("Batch has no products", 400);

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.transferBatch.findUnique({ where: { id: batch.id } });
    if (!fresh || fresh.status !== "PENDING") {
      throw new AppError("Batch is no longer pending", 400, "BATCH_NOT_PENDING");
    }

    const entryNo = await allocateDocumentNo("ENT", "ENT", tx);
    const entry = await tx.stockEntry.create({
      data: {
        entryNo,
        txnType: "INWARD",
        siteId: batch.toSiteId,
        destinationSiteId: null,
        remarks: `Received transfer ${batch.batchNo}`,
        performedById: user.id,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            barcode: l.barcode || null,
            quantity: Number(l.quantity),
            weight: Number(l.weight || 0),
            rate: 0,
            remarks: null,
          })),
        },
      },
      include: {
        lines: { include: { product: true } },
        site: true,
        performedBy: true,
      },
    });

    for (const line of lines) {
      await applyDelta(tx, {
        siteId: batch.toSiteId,
        productId: line.productId,
        qtyDelta: Number(line.quantity),
        weightDelta: Number(line.weight || 0),
      });
    }

    const updated = await tx.transferBatch.update({
      where: { id: batch.id },
      data: {
        status: "RECEIVED",
        receiveEntryId: entry.id,
        receivedById: user.id,
        receivedAt: new Date(),
      },
      include: {
        fromSite: true,
        toSite: true,
        createdBy: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
      },
    });

    return { batch: updated, entry };
  });
}

module.exports = { findBatchByCode, listBatches, receiveBatch };
