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
 * Build receive lines: shop can edit qty down (0 = not received), never above sent.
 * Missing qty returns to factory stock.
 */
function resolveReceiveLines(sentLines, edits) {
  const byProduct = new Map();
  for (const e of edits || []) {
    if (e?.productId) byProduct.set(String(e.productId), e);
  }

  const received = [];
  const shortfall = [];

  for (const sent of sentLines) {
    const productId = String(sent.productId);
    const sentQty = Number(sent.quantity);
    const sentWt = Number(sent.weight || 0);
    const edit = byProduct.get(productId);

    let recvQty = sentQty;
    let recvWt = sentWt;
    if (edit) {
      if (edit.quantity != null) recvQty = Number(edit.quantity);
      if (edit.weight != null) recvWt = Number(edit.weight);
    }

    if (Number.isNaN(recvQty) || recvQty < 0) {
      throw new AppError(`Invalid qty for ${sent.name || productId}`, 400);
    }
    if (recvQty > sentQty + 0.0001) {
      throw new AppError(
        `Cannot receive more than sent for ${sent.name || productId} (sent ${sentQty})`,
        400,
        "QTY_EXCEEDS_SENT"
      );
    }

    // Scale weight if only qty edited
    if (edit && edit.quantity != null && edit.weight == null && sentQty > 0) {
      recvWt = (sentWt * recvQty) / sentQty;
    }
    if (recvWt < 0) recvWt = 0;
    if (recvWt > sentWt + 0.0001) recvWt = sentWt;

    const missQty = sentQty - recvQty;
    const missWt = sentWt - recvWt;

    received.push({
      productId,
      sku: sent.sku,
      name: sent.name,
      barcode: sent.barcode || null,
      quantity: recvQty,
      weight: recvWt,
      sentQuantity: sentQty,
      sentWeight: sentWt,
    });

    if (missQty > 0.0001 || missWt > 0.0001) {
      shortfall.push({
        productId,
        sku: sent.sku,
        name: sent.name,
        quantity: missQty,
        weight: Math.max(0, missWt),
      });
    }
  }

  // Reject unknown productIds in edits
  for (const [pid] of byProduct) {
    if (!sentLines.some((s) => String(s.productId) === pid)) {
      throw new AppError(`Product ${pid} is not in this batch`, 400);
    }
  }

  const totalRecv = received.reduce((s, l) => s + l.quantity, 0);
  if (totalRecv <= 0) {
    throw new AppError("Receive at least one product (qty > 0)", 400);
  }

  return { received, shortfall };
}

/**
 * Shop receives PENDING batch. Optional edits: qty/weight <= sent; shortfall → factory.
 */
async function receiveBatch({ user, code, lines: edits }) {
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

  const sentLines = Array.isArray(batch.lineSnapshot) ? batch.lineSnapshot : [];
  if (!sentLines.length) throw new AppError("Batch has no products", 400);

  const { received, shortfall } = resolveReceiveLines(sentLines, edits);
  const inwardLines = received.filter((l) => l.quantity > 0);

  return prisma.$transaction(
    async (tx) => {
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
          remarks:
            shortfall.length > 0
              ? `Received transfer ${batch.batchNo} (partial — shortfall returned to factory)`
              : `Received transfer ${batch.batchNo}`,
          performedById: user.id,
          lines: {
            create: inwardLines.map((l) => ({
              productId: l.productId,
              barcode: l.barcode || null,
              quantity: Number(l.quantity),
              weight: Number(l.weight || 0),
              rate: 0,
              remarks:
                l.quantity < l.sentQuantity
                  ? `Sent ${l.sentQuantity}, received ${l.quantity}`
                  : null,
            })),
          },
        },
        include: {
          lines: { include: { product: true } },
          site: true,
          performedBy: true,
        },
      });

      for (const line of inwardLines) {
        await applyDelta(tx, {
          siteId: batch.toSiteId,
          productId: line.productId,
          qtyDelta: Number(line.quantity),
          weightDelta: Number(line.weight || 0),
        });
      }

      // Not received / short qty → return to factory
      for (const miss of shortfall) {
        await applyDelta(tx, {
          siteId: batch.fromSiteId,
          productId: miss.productId,
          qtyDelta: Number(miss.quantity),
          weightDelta: Number(miss.weight || 0),
        });
      }

      const updated = await tx.transferBatch.update({
        where: { id: batch.id },
        data: {
          status: "RECEIVED",
          receiveEntryId: entry.id,
          receivedById: user.id,
          receivedAt: new Date(),
          receivedSnapshot: received,
        },
        include: {
          fromSite: true,
          toSite: true,
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      });

      return { batch: updated, entry, shortfall };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );
}

module.exports = { findBatchByCode, listBatches, receiveBatch };
