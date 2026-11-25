const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.productBarcode.updateMany({
    data: { symbology: "QR" },
  });
  console.log(`Updated ${result.count} product codes to QR symbology.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
