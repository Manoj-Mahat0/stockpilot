const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ANDROID_PHONES = [
  { sku: "PHN-S24U", name: "Samsung Galaxy S24 Ultra", barcode: "SP-PHN-S24U-001", qty: 40, weight: 9.2, price: 98000 },
  { sku: "PHN-S24", name: "Samsung Galaxy S24", barcode: "SP-PHN-S24-001", qty: 55, weight: 8.5, price: 72000 },
  { sku: "PHN-A55", name: "Samsung Galaxy A55 5G", barcode: "SP-PHN-A55-001", qty: 80, weight: 10.0, price: 32000 },
  { sku: "PHN-A35", name: "Samsung Galaxy A35 5G", barcode: "SP-PHN-A35-001", qty: 90, weight: 10.5, price: 25000 },
  { sku: "PHN-M35", name: "Samsung Galaxy M35 5G", barcode: "SP-PHN-M35-001", qty: 70, weight: 9.8, price: 18000 },
  { sku: "PHN-PX8P", name: "Google Pixel 8 Pro", barcode: "SP-PHN-PX8P-001", qty: 25, weight: 6.0, price: 85000 },
  { sku: "PHN-PX8", name: "Google Pixel 8", barcode: "SP-PHN-PX8-001", qty: 30, weight: 5.5, price: 62000 },
  { sku: "PHN-PX7A", name: "Google Pixel 7a", barcode: "SP-PHN-PX7A-001", qty: 45, weight: 7.0, price: 35000 },
  { sku: "PHN-ONE12", name: "OnePlus 12", barcode: "SP-PHN-ONE12-001", qty: 35, weight: 7.2, price: 58000 },
  { sku: "PHN-ONEN3", name: "OnePlus Nord 3 5G", barcode: "SP-PHN-ONEN3-001", qty: 60, weight: 8.0, price: 28000 },
  { sku: "PHN-RMN13P", name: "Xiaomi Redmi Note 13 Pro", barcode: "SP-PHN-RMN13P-001", qty: 100, weight: 12.0, price: 22000 },
  { sku: "PHN-POCOX6", name: "POCO X6 5G", barcode: "SP-PHN-POCOX6-001", qty: 75, weight: 9.0, price: 20000 },
  { sku: "PHN-RM12", name: "Realme 12 5G", barcode: "SP-PHN-RM12-001", qty: 65, weight: 8.8, price: 17000 },
  { sku: "PHN-VIVOY200", name: "vivo Y200 5G", barcode: "SP-PHN-VIVOY200-001", qty: 50, weight: 7.5, price: 19000 },
  { sku: "PHN-OPPOA59", name: "OPPO A59 5G", barcode: "SP-PHN-OPPOA59-001", qty: 55, weight: 7.8, price: 16000 },
  { sku: "PHN-MOTOG84", name: "Motorola G84 5G", barcode: "SP-PHN-MOTOG84-001", qty: 40, weight: 6.5, price: 21000 },
  { sku: "PHN-NQ3", name: "Nothing Phone (2a)", barcode: "SP-PHN-NQ2A-001", qty: 28, weight: 5.2, price: 24000 },
  { sku: "PHN-IQZ9", name: "iQOO Z9 5G", barcode: "SP-PHN-IQZ9-001", qty: 48, weight: 7.0, price: 20000 },
];

async function main() {
  console.log("Clearing old product-related data...");

  // Factory/Shop domain first
  await prisma.document.deleteMany({});
  await prisma.stockEntryLine.deleteMany({});
  await prisma.stockEntry.deleteMany({});
  await prisma.siteStock.deleteMany({});

  // Legacy warehouse domain linked to products
  await prisma.stockAuditItem.deleteMany({});
  await prisma.stockAdjustment.deleteMany({});
  await prisma.stockTransaction.deleteMany({});
  await prisma.stockOutItem.deleteMany({});
  await prisma.stockInItem.deleteMany({});
  await prisma.stockBalance.deleteMany({});
  await prisma.productBarcode.deleteMany({});
  await prisma.product.deleteMany({});

  console.log("Old products removed.");

  const unit = await prisma.unit.upsert({
    where: { symbol: "PCS" },
    create: { name: "Pieces", symbol: "PCS" },
    update: {},
  });

  const category = await prisma.category.upsert({
    where: { name: "Android Phones" },
    create: { name: "Android Phones", description: "Android smartphones" },
    update: { description: "Android smartphones" },
  });

  let brand = await prisma.brand.findFirst({ where: { name: "Android Devices" } });
  if (!brand) {
    brand = await prisma.brand.create({ data: { name: "Android Devices" } });
  }

  const factory = await prisma.site.findUnique({ where: { code: "FAC-HQ" } });
  if (!factory) throw new Error("Factory site FAC-HQ missing — run full seed first");

  for (const p of ANDROID_PHONES) {
    const product = await prisma.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        description: "Android smartphone",
        categoryId: category.id,
        brandId: brand.id,
        unitId: unit.id,
        purchasePrice: p.price,
        sellingPrice: Math.round(p.price * 1.12),
        minStock: 5,
        reorderLevel: 10,
        barcodes: {
          create: { value: p.barcode, symbology: "CODE128", isPrimary: true },
        },
      },
    });

    await prisma.siteStock.create({
      data: {
        siteId: factory.id,
        productId: product.id,
        quantity: p.qty,
        weight: p.weight,
      },
    });

    console.log(" +", product.sku, product.name);
  }

  console.log(`Done. Added ${ANDROID_PHONES.length} Android phones to factory stock.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
