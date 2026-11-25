const { prisma } = require("../config/prisma");

async function allocateDocumentNo(key, prefix, tx = prisma) {
  const existing = await tx.documentSequence.findUnique({ where: { key } });
  if (!existing) {
    await tx.documentSequence.create({
      data: { key, prefix, nextNumber: 2 },
    });
    return `${prefix}-00001`;
  }

  const current = existing.nextNumber;
  await tx.documentSequence.update({
    where: { key },
    data: { nextNumber: { increment: 1 } },
  });
  return `${prefix}-${String(current).padStart(5, "0")}`;
}

module.exports = { allocateDocumentNo };
