const { prisma } = require("../config/prisma");
const { AppError } = require("../utils/errors");
const { allocateDocumentNo } = require("../utils/sequences");

function num(v) {
  return Number(v || 0);
}

async function getProductBalance(tx, productId) {
  const aggregates = await tx.stockBalance.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return num(aggregates._sum.quantity);
}

async function getOrCreateBalance(tx, { productId, locationId, batchNo = "" }) {
  const key = { productId, locationId, batchNo: batchNo || "" };
  let balance = await tx.stockBalance.findUnique({
    where: { productId_locationId_batchNo: key },
  });
  if (!balance) {
    balance = await tx.stockBalance.create({
      data: {
        productId,
        locationId,
        batchNo: batchNo || "",
        quantity: 0,
      },
    });
  }
  return balance;
}

async function applyStockChange(
  tx,
  {
    productId,
    locationId,
    quantityIn = 0,
    quantityOut = 0,
    type,
    performedById,
    batchNo = null,
    expiryDate = null,
    reference = null,
    remarks = null,
    adjustmentId = null,
  }
) {
  const batchKey = batchNo || "";
  const balance = await getOrCreateBalance(tx, {
    productId,
    locationId,
    batchNo: batchKey,
  });

  const current = num(balance.quantity);
  const inQty = num(quantityIn);
  const outQty = num(quantityOut);
  const next = current + inQty - outQty;

  if (next < 0) {
    throw new AppError("Insufficient stock at location", 400, "INSUFFICIENT_STOCK");
  }

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: {
      quantity: next,
      expiryDate: expiryDate || balance.expiryDate,
    },
  });

  const productTotal = await getProductBalance(tx, productId);
  const transactionNo = await allocateDocumentNo("TX", "TX", tx);

  return tx.stockTransaction.create({
    data: {
      transactionNo,
      type,
      productId,
      locationId,
      quantityIn: inQty,
      quantityOut: outQty,
      runningBalance: productTotal,
      batchNo: batchNo || null,
      expiryDate,
      reference,
      remarks,
      performedById,
      adjustmentId,
    },
  });
}

async function completeStockIn({ sessionId, userId }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.stockInSession.findUnique({
      where: { id: sessionId },
      include: { items: true },
    });
    if (!session) throw new AppError("Stock In session not found", 404);
    if (session.status !== "DRAFT") throw new AppError("Session already completed", 400);
    if (!session.items.length) throw new AppError("Add at least one line item", 400);

    for (const item of session.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.status !== "ACTIVE") {
        throw new AppError(`Product inactive: ${item.productId}`, 400);
      }
      const location = await tx.location.findUnique({ where: { id: item.locationId } });
      if (!location || location.status !== "ACTIVE") {
        throw new AppError("Invalid or blocked location", 400);
      }
      if (num(item.quantity) <= 0) {
        throw new AppError("Quantity must be positive", 400);
      }

      await applyStockChange(tx, {
        productId: item.productId,
        locationId: item.locationId,
        quantityIn: item.quantity,
        type: "STOCK_IN",
        performedById: userId,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
        reference: session.grnNo,
        remarks: session.remarks,
      });
    }

    return tx.stockInSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: { items: { include: { product: true, location: true } }, performedBy: true },
    });
  });
}

async function completeStockOut({ sessionId, userId }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.stockOutSession.findUnique({
      where: { id: sessionId },
      include: { items: true },
    });
    if (!session) throw new AppError("Stock Out session not found", 404);
    if (session.status !== "DRAFT") throw new AppError("Session already completed", 400);
    if (!session.items.length) throw new AppError("Add at least one line item", 400);

    for (const item of session.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.status !== "ACTIVE") {
        throw new AppError("Product is inactive", 400);
      }
      if (num(item.quantity) <= 0) {
        throw new AppError("Quantity must be positive", 400);
      }

      await applyStockChange(tx, {
        productId: item.productId,
        locationId: item.locationId,
        quantityOut: item.quantity,
        type: "STOCK_OUT",
        performedById: userId,
        batchNo: item.batchNo,
        reference: session.issueNo,
        remarks: session.remarks,
      });
    }

    return tx.stockOutSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: { items: { include: { product: true, location: true } }, performedBy: true },
    });
  });
}

async function createAdjustment({
  productId,
  locationId,
  quantityDelta,
  reason,
  batchNo,
  remarks,
  userId,
}) {
  return prisma.$transaction(async (tx) => {
    const delta = num(quantityDelta);
    if (delta === 0) throw new AppError("Adjustment quantity cannot be zero", 400);

    const balance = await getOrCreateBalance(tx, {
      productId,
      locationId,
      batchNo: batchNo || "",
    });
    const oldQuantity = num(balance.quantity);
    const newQuantity = oldQuantity + delta;
    if (newQuantity < 0) {
      throw new AppError("Adjustment would make stock negative", 400);
    }

    const adjustmentNo = await allocateDocumentNo("ADJ", "ADJ", tx);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        adjustmentNo,
        productId,
        locationId,
        reason,
        oldQuantity,
        quantityDelta: delta,
        newQuantity,
        batchNo: batchNo || null,
        remarks,
        performedById: userId,
      },
    });

    await applyStockChange(tx, {
      productId,
      locationId,
      quantityIn: delta > 0 ? delta : 0,
      quantityOut: delta < 0 ? Math.abs(delta) : 0,
      type: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      performedById: userId,
      batchNo,
      remarks,
      reference: adjustmentNo,
      adjustmentId: adjustment.id,
    });

    return adjustment;
  });
}

module.exports = {
  applyStockChange,
  completeStockIn,
  completeStockOut,
  createAdjustment,
  getOrCreateBalance,
};
