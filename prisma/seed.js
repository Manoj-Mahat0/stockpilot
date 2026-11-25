const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      companyName: "StockPilot",
      tagline: "Factory & Shop Stock Control",
      warehouseLabel: "Main Factory • HQ-01",
    },
    update: {
      tagline: "Factory & Shop Stock Control",
    },
  });

  const adminHash = await bcrypt.hash("Admin@12345", 12);
  const factoryHash = await bcrypt.hash("Factory@12345", 12);
  const shopHash = await bcrypt.hash("Shop@12345", 12);

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ employeeId: "ADM-001" }, { email: "a@gmail.com" }] },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          employeeId: "ADM-001",
          name: "Alex Morgan",
          email: "a@gmail.com",
          passwordHash: adminHash,
          role: "ADMIN",
          status: "ACTIVE",
          department: "Operations",
          canDeleteEntry: true,
          canViewStock: true,
          canInward: true,
          canOutward: true,
          canEditEntry: true,
          canPrintDocs: true,
          canViewReports: true,
        },
      })
    : await prisma.user.create({
        data: {
          employeeId: "ADM-001",
          name: "Alex Morgan",
          email: "a@gmail.com",
          passwordHash: adminHash,
          role: "ADMIN",
          department: "Operations",
          canDeleteEntry: true,
          canEditEntry: true,
        },
      });

  const factoryUser = await prisma.user.upsert({
    where: { email: "factory@stockpilot.local" },
    create: {
      employeeId: "FAC-001",
      name: "Ravi Factory",
      email: "factory@stockpilot.local",
      passwordHash: factoryHash,
      role: "FACTORY",
      department: "Production",
      canDeleteEntry: false,
      canViewStock: true,
      canInward: true,
      canOutward: true,
      canPrintDocs: true,
    },
    update: {
      passwordHash: factoryHash,
      role: "FACTORY",
      status: "ACTIVE",
      canInward: true,
      canOutward: true,
      canViewStock: true,
    },
  });

  const shopUser = await prisma.user.upsert({
    where: { email: "shop@stockpilot.local" },
    create: {
      employeeId: "SHP-001",
      name: "Neha Shop",
      email: "shop@stockpilot.local",
      passwordHash: shopHash,
      role: "SHOP",
      department: "Retail",
      canDeleteEntry: false,
      canViewStock: true,
      canInward: true,
      canOutward: true,
      canEditEntry: false,
      canPrintDocs: true,
      canViewReports: true,
    },
    update: {
      passwordHash: shopHash,
      role: "SHOP",
      status: "ACTIVE",
      canViewStock: true,
      canInward: true,
      canOutward: true,
      canPrintDocs: true,
      canViewReports: true,
    },
  });

  const factory = await prisma.site.upsert({
    where: { code: "FAC-HQ" },
    create: {
      code: "FAC-HQ",
      name: "Main Factory",
      type: "FACTORY",
      address: "Industrial Area, HQ",
    },
    update: { isActive: true, name: "Main Factory" },
  });

  const shop1 = await prisma.site.upsert({
    where: { code: "SHP-01" },
    create: {
      code: "SHP-01",
      name: "City Shop 01",
      type: "SHOP",
      address: "Market Road",
    },
    update: { isActive: true },
  });

  const shop2 = await prisma.site.upsert({
    where: { code: "SHP-02" },
    create: {
      code: "SHP-02",
      name: "Mall Shop 02",
      type: "SHOP",
      address: "City Mall",
    },
    update: { isActive: true },
  });

  for (const [userId, siteId] of [
    [factoryUser.id, factory.id],
    [shopUser.id, shop1.id],
  ]) {
    const existing = await prisma.userSite.findFirst({ where: { userId, siteId } });
    if (!existing) {
      await prisma.userSite.create({ data: { userId, siteId } });
    }
  }

  const unit = await prisma.unit.upsert({
    where: { symbol: "PCS" },
    create: { name: "Pieces", symbol: "PCS" },
    update: {},
  });

  const category = await prisma.category.upsert({
    where: { name: "General" },
    create: { name: "General" },
    update: {},
  });

  const productsData = [
    { sku: "SCN-X2", name: "Barcode Scanner Pro X2", barcode: "SP-SCN-X2-001", qty: 100, weight: 50, price: 120 },
    { sku: "LBL-4X6", name: "Thermal Label Roll 4x6", barcode: "SP-LBL-4X6-001", qty: 200, weight: 80, price: 18 },
    { sku: "HEX-M8", name: "M8 Steel Hex Bolts (Box)", barcode: "SP-HEX-M8-001", qty: 80, weight: 40, price: 8 },
  ];

  for (const p of productsData) {
    let product = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (!product) {
      product = await prisma.product.create({
        data: {
          sku: p.sku,
          name: p.name,
          categoryId: category.id,
          unitId: unit.id,
          purchasePrice: p.price,
          sellingPrice: p.price * 1.4,
          barcodes: {
            create: { value: p.barcode, symbology: "CODE128", isPrimary: true },
          },
        },
      });
    } else {
      const bc = await prisma.productBarcode.findFirst({ where: { value: p.barcode } });
      if (!bc) {
        await prisma.productBarcode.create({
          data: { productId: product.id, value: p.barcode, symbology: "CODE128", isPrimary: true },
        });
      }
    }

    await prisma.siteStock.upsert({
      where: { siteId_productId: { siteId: factory.id, productId: product.id } },
      create: {
        siteId: factory.id,
        productId: product.id,
        quantity: p.qty,
        weight: p.weight,
      },
      update: { quantity: p.qty, weight: p.weight },
    });
  }

  for (const key of [
    ["ENT", "ENT"],
    ["CHL", "CHL"],
    ["INV", "INV"],
    ["GRN", "GRN"],
    ["ISS", "ISS"],
    ["TX", "TX"],
    ["ADJ", "ADJ"],
    ["AUD", "AUD"],
  ]) {
    await prisma.documentSequence.upsert({
      where: { key: key[0] },
      create: { key: key[0], prefix: key[1], nextNumber: 1 },
      update: {},
    });
  }

  console.log("Seed complete (Factory/Shop)");
  console.log("Admin:   a@gmail.com / Admin@12345");
  console.log("Factory: factory@stockpilot.local / Factory@12345");
  console.log("Shop:    shop@stockpilot.local / Shop@12345");
  console.log("Admin id:", admin.id, "Sites:", factory.code, shop1.code, shop2.code);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
