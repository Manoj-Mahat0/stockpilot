const { prisma } = require("../config/prisma");
const { AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");
const { applyDelta } = require("./entryService");

const ISSUE_TYPES = new Set(["OK", "DAMAGED", "MISSING", "WRONG", "PARTIAL"]);

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
 * Per line:
 * - goodQty → shop stock
 * - damagedQty → written off (not shop / not factory sellable), recorded
 * - missing = sent - good - damaged → return to factory
 * - WRONG: typically good=0, missing=sent, notes = what actually arrived
 */
function resolveReceiveLines(sentLines, edits) {
  const byProduct = new Map();
  for (const e of edits || []) {
    if (e?.productId) byProduct.set(String(e.productId), e);
  }

  const received = [];
  const shortfall = []; // return to factory
  const damaged = [];

  for (const sent of sentLines) {
    const productId = String(sent.productId);
    const sentQty = Number(sent.quantity);
    const sentWt = Number(sent.weight || 0);
    const edit = byProduct.get(productId) || {};

    let issueType = String(edit.issueType || "OK").toUpperCase();
    if (!ISSUE_TYPES.has(issueType)) issueType = "OK";

    let goodQty = edit.quantity != null ? Number(edit.quantity) : sentQty;
    let damagedQty = edit.damagedQuantity != null ? Number(edit.damagedQuantity) : 0;
    const notes = edit.notes ? String(edit.notes).trim() : "";

    if (issueType === "MISSING") {
      goodQty = 0;
      damagedQty = 0;
    } else if (issueType === "WRONG") {
      // Expected product not usable; return full to factory unless shop set partial good
      if (edit.quantity == null) goodQty = 0;
      if (edit.damagedQuantity == null) damagedQty = 0;
    } else if (issueType === "DAMAGED" && edit.quantity == null && edit.damagedQuantity == null) {
      goodQty = 0;
      damagedQty = sentQty;
    }

    if (Number.isNaN(goodQty) || goodQty < 0) {
      throw new AppError(`Invalid received qty for ${sent.name || productId}`, 400);
    }
    if (Number.isNaN(damagedQty) || damagedQty < 0) {
      throw new AppError(`Invalid damaged qty for ${sent.name || productId}`, 400);
    }
    if (goodQty + damagedQty > sentQty + 0.0001) {
      throw new AppError(
        `${sent.name || productId}: good + damaged cannot exceed sent (${sentQty})`,
        400,
        "QTY_EXCEEDS_SENT"
      );
    }

    const missQty = Math.max(0, sentQty - goodQty - damagedQty);
    const unitWt = sentQty > 0 ? sentWt / sentQty : 0;
    const goodWt = unitWt * goodQty;
    const damagedWt = unitWt * damagedQty;
    const missWt = unitWt * missQty;

    if (issueType === "OK" && (goodQty < sentQty || damagedQty > 0 || missQty > 0)) {
      issueType = damagedQty > 0 ? "DAMAGED" : missQty >= sentQty ? "MISSING" : "PARTIAL";
    }

    received.push({
      productId,
      sku: sent.sku,
      name: sent.name,
      barcode: sent.barcode || null,
      quantity: goodQty,
      weight: goodWt,
      damagedQuantity: damagedQty,
      damagedWeight: damagedWt,
      missingQuantity: missQty,
      sentQuantity: sentQty,
      sentWeight: sentWt,
      issueType,
      notes: notes || null,
    });

    if (missQty > 0.0001) {
      shortfall.push({
        productId,
        sku: sent.sku,
        name: sent.name,
        quantity: missQty,
        weight: missWt,
        reason: issueType === "WRONG" ? "WRONG_ITEM" : "MISSING",
      });
    }

    if (damagedQty > 0.0001) {
      damaged.push({
        productId,
        sku: sent.sku,
        name: sent.name,
        quantity: damagedQty,
        weight: damagedWt,
        notes: notes || null,
      });
    }
  }

  for (const [pid] of byProduct) {
    if (!sentLines.some((s) => String(s.productId) === pid)) {
      throw new AppError(`Product ${pid} is not in this batch`, 400);
    }
  }

  // Allow all-missing only if at least one line has WRONG/DAMAGED/MISSING recorded
  // Require either some good stock OR explicit exception (damaged/wrong/missing all ok for closing batch)
  const totalGood = received.reduce((s, l) => s + l.quantity, 0);
  const hasException = received.some((l) => l.issueType !== "OK" || l.damagedQuantity > 0 || l.missingQuantity > 0);
  if (totalGood <= 0 && !hasException) {
    throw new AppError("Receive at least one product or mark issues (damaged / missing / wrong)", 400);
  }
  // If everything missing with no notes on wrong - still allow closing batch (all returned)
  if (totalGood <= 0 && received.every((l) => l.missingQuantity >= l.sentQuantity)) {
    // ok — full return to factory
  }

  return { received, shortfall, damaged };
}

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

  const { received, shortfall, damaged } = resolveReceiveLines(sentLines, edits);
  const inwardLines = received.filter((l) => l.quantity > 0);

  return prisma.$transaction(
    async (tx) => {
      const fresh = await tx.transferBatch.findUnique({ where: { id: batch.id } });
      if (!fresh || fresh.status !== "PENDING") {
        throw new AppError("Batch is no longer pending", 400, "BATCH_NOT_PENDING");
      }

      const bits = [];
      if (damaged.length) bits.push(`${damaged.length} damaged`);
      if (shortfall.length) bits.push(`${shortfall.length} returned to factory`);
      const remarkExtra = bits.length ? ` (${bits.join(", ")})` : "";

      const entryNo = await allocateDocumentNo("ENT", "ENT", tx);
      const entry = await tx.stockEntry.create({
        data: {
          entryNo,
          txnType: "INWARD",
          siteId: batch.toSiteId,
          destinationSiteId: null,
          remarks:
            inwardLines.length > 0
              ? `Received transfer ${batch.batchNo}${remarkExtra}`
              : `Closed transfer ${batch.batchNo} with exceptions${remarkExtra}`,
          performedById: user.id,
          lines: {
            create: received.map((l) => ({
              productId: l.productId,
              barcode: l.barcode || null,
              quantity: Number(l.quantity),
              weight: Number(l.weight || 0),
              rate: 0,
              remarks:
                [
                  l.issueType !== "OK" ? l.issueType : null,
                  l.damagedQuantity > 0 ? `damaged ${l.damagedQuantity}` : null,
                  l.missingQuantity > 0 ? `missing ${l.missingQuantity}` : null,
                  l.notes,
                ]
                  .filter(Boolean)
                  .join(" · ") || null,
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

      for (const miss of shortfall) {
        await applyDelta(tx, {
          siteId: batch.fromSiteId,
          productId: miss.productId,
          qtyDelta: Number(miss.quantity),
          weightDelta: Number(miss.weight || 0),
        });
      }

      // Damaged: not returned as sellable — already deducted from factory on send, not added to shop

      const updated = await tx.transferBatch.update({
        where: { id: batch.id },
        data: {
          status: "RECEIVED",
          receiveEntryId: entry.id,
          receivedById: user.id,
          receivedAt: new Date(),
          receivedSnapshot: { lines: received, damaged, shortfall },
        },
        include: {
          fromSite: true,
          toSite: true,
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      });

      return { batch: updated, entry, shortfall, damaged };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );
}

module.exports = { findBatchByCode, listBatches, receiveBatch };
