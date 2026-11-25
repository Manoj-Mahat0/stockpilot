const { prisma } = require("../config/prisma");
const { AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");

async function getOrCreateSiteStock(tx, siteId, productId) {
  let row = await tx.siteStock.findUnique({
    where: { siteId_productId: { siteId, productId } },
  });
  if (!row) {
    row = await tx.siteStock.create({
      data: { siteId, productId, quantity: 0, weight: 0 },
    });
  }
  return row;
}

async function applyDelta(tx, { siteId, productId, qtyDelta, weightDelta }) {
  const row = await getOrCreateSiteStock(tx, siteId, productId);
  const nextQty = Number(row.quantity) + qtyDelta;
  const nextWeight = Number(row.weight) + weightDelta;
  if (nextQty < -0.0001) {
    throw new AppError("Insufficient stock quantity at site", 400, "INSUFFICIENT_STOCK");
  }
  if (nextWeight < -0.0001) {
    throw new AppError("Insufficient stock weight at site", 400, "INSUFFICIENT_STOCK");
  }
  return tx.siteStock.update({
    where: { id: row.id },
    data: {
      quantity: Math.max(0, nextQty),
      weight: Math.max(0, nextWeight),
    },
  });
}

async function createEntry({
  user,
  txnType,
  siteId,
  destinationSiteId,
  remarks,
  lines,
  docType,
  customerName,
  customerPhone,
  customerGstin,
  gstRate,
}) {
  if (!lines?.length) throw new AppError("Add at least one line", 400);

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site || !site.isActive) throw new AppError("Invalid site", 400);

  if (user.role !== "ADMIN" && !user.siteIds.includes(siteId)) {
    throw new AppError("Not assigned to this site", 403);
  }

  if (user.role === "FACTORY" && site.type !== "FACTORY") {
    throw new AppError("Factory users can only post to factory sites", 403);
  }
  if (user.role === "SHOP" && site.type !== "SHOP") {
    throw new AppError("Shop users can only post to shop sites", 403);
  }

  // Shop cannot free-inward — only receive factory transfer batch via QR
  if (txnType === "INWARD" && site.type === "SHOP" && user.role === "SHOP") {
    throw new AppError(
      "Shop receive only via factory transfer QR. Scan the batch QR to inward.",
      403,
      "TRANSFER_QR_REQUIRED"
    );
  }

  if (txnType === "INWARD" && !user.canInward && user.role !== "ADMIN") {
    throw new AppError("Inward not permitted", 403);
  }
  if (txnType === "OUTWARD" && !user.canOutward && user.role !== "ADMIN") {
    throw new AppError("Outward not permitted", 403);
  }

  const isFactoryDispatch = txnType === "OUTWARD" && site.type === "FACTORY";
  if (isFactoryDispatch) {
    if (!destinationSiteId) throw new AppError("Destination shop required", 400);
    const dest = await prisma.site.findUnique({ where: { id: destinationSiteId } });
    if (!dest || dest.type !== "SHOP" || !dest.isActive) {
      throw new AppError("Destination must be an active shop", 400);
    }
  }

  return prisma.$transaction(async (tx) => {
    const entryNo = await allocateDocumentNo("ENT", "ENT", tx);

    const entry = await tx.stockEntry.create({
      data: {
        entryNo,
        txnType,
        siteId,
        destinationSiteId: destinationSiteId || null,
        remarks: remarks || null,
        performedById: user.id,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            barcode: l.barcode || null,
            quantity: Number(l.quantity),
            weight: Number(l.weight || 0),
            rate: Number(l.rate || 0),
            remarks: l.remarks || null,
          })),
        },
      },
      include: {
        lines: { include: { product: { include: { barcodes: true } } } },
        site: true,
        destinationSite: true,
        performedBy: true,
      },
    });

    for (const line of entry.lines) {
      const qty = Number(line.quantity);
      const weight = Number(line.weight || 0);
      if (qty <= 0) throw new AppError("Quantity must be positive", 400);

      if (txnType === "INWARD") {
        await applyDelta(tx, {
          siteId,
          productId: line.productId,
          qtyDelta: qty,
          weightDelta: weight,
        });
      } else {
        // Deduct from source only. Factory→Shop credits shop on RECEIVE, not here.
        await applyDelta(tx, {
          siteId,
          productId: line.productId,
          qtyDelta: -qty,
          weightDelta: -weight,
        });
      }
    }

    let document = null;
    let batch = null;
    const shouldChallan = isFactoryDispatch;
    const shouldShopDoc = txnType === "OUTWARD" && site.type === "SHOP";

    if (shouldChallan || shouldShopDoc) {
      const type = shouldChallan ? "CHALLAN" : docType === "INVOICE" ? "INVOICE" : "CHALLAN";
      const prefix = type === "INVOICE" ? "INV" : "CHL";
      const key = type === "INVOICE" ? "INV" : "CHL";
      const docNo = await allocateDocumentNo(key, prefix, tx);

      let subtotal = 0;
      const snapshot = entry.lines.map((l) => {
        const amount = Number(l.quantity) * Number(l.rate || 0);
        subtotal += amount;
        const primaryBc = l.product.barcodes?.find((b) => b.isPrimary) || l.product.barcodes?.[0];
        return {
          productId: l.productId,
          sku: l.product.sku,
          name: l.product.name,
          barcode: l.barcode || primaryBc?.value || null,
          quantity: l.quantity,
          weight: l.weight,
          rate: l.rate,
          amount,
        };
      });

      const rate = Number(gstRate || 0);
      const gstAmount = type === "INVOICE" ? (subtotal * rate) / 100 : 0;
      const totalAmount = subtotal + gstAmount;

      document = await tx.document.create({
        data: {
          docNo,
          type,
          siteId,
          stockEntryId: entry.id,
          customerName: customerName || null,
          customerPhone: customerPhone || null,
          customerGstin: customerGstin || null,
          gstRate: rate,
          subtotal,
          gstAmount,
          totalAmount,
          remarks: remarks || null,
          lineSnapshot: snapshot,
          createdById: user.id,
        },
      });
    }

    if (isFactoryDispatch) {
      const batchNo = await allocateDocumentNo("BAT", "BAT", tx);
      const qrValue = `SP-BATCH-${batchNo}`;
      const lineSnapshot = entry.lines.map((l) => {
        const primaryBc = l.product.barcodes?.find((b) => b.isPrimary) || l.product.barcodes?.[0];
        return {
          productId: l.productId,
          sku: l.product.sku,
          name: l.product.name,
          barcode: l.barcode || primaryBc?.value || null,
          quantity: Number(l.quantity),
          weight: Number(l.weight || 0),
        };
      });

      batch = await tx.transferBatch.create({
        data: {
          batchNo,
          qrValue,
          fromSiteId: siteId,
          toSiteId: destinationSiteId,
          status: "PENDING",
          stockEntryId: entry.id,
          lineSnapshot,
          remarks: remarks || null,
          createdById: user.id,
        },
        include: {
          fromSite: true,
          toSite: true,
        },
      });
    }

    return { entry, document, batch };
  });
}

module.exports = { createEntry, applyDelta, getOrCreateSiteStock };
