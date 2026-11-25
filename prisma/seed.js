const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  await prisma.companySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      companyName: "StockPilot",
      tagline: "Scan. Track. Control. Everything in Stock.",
      warehouseLabel: "Main Warehouse • HQ-01",
    },
    update: {},
  });

  const adminHash = await bcrypt.hash("Admin@12345", 12);
  const staffHash = await bcrypt.hash("Staff@12345", 12);

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ employeeId: "ADM-001" }, { email: "admin@stockpilot.local" }, { email: "a@gmail.com" }] },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          employeeId: "ADM-001",
          name: "Alex Morgan",
          email: "a@gmail.com",
          phone: "+1-555-0100",
          passwordHash: adminHash,
          role: "ADMIN",
          status: "ACTIVE",
          department: "Operations",
        },
      })
    : await prisma.user.create({
        data: {
          employeeId: "ADM-001",
          name: "Alex Morgan",
          email: "a@gmail.com",
          phone: "+1-555-0100",
          passwordHash: adminHash,
          role: "ADMIN",
          department: "Operations",
          joiningDate: new Date("2024-01-01"),
        },
      });

  const staff = await prisma.user.upsert({
    where: { email: "staff@stockpilot.local" },
    create: {
      employeeId: "EMP-104",
      name: "Marcus Chen",
      email: "staff@stockpilot.local",
      phone: "+1-555-0104",
      passwordHash: staffHash,
      role: "STAFF",
      department: "Warehouse Floor",
      joiningDate: new Date("2024-06-01"),
    },
    update: { passwordHash: staffHash, status: "ACTIVE" },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { code: "MAIN-WH" },
    create: { code: "MAIN-WH", name: "Main Warehouse", isActive: true },
    update: { isActive: true },
  });

  // Deactivate any other warehouses (single warehouse rule)
  await prisma.warehouse.updateMany({
    where: { NOT: { id: warehouse.id } },
    data: { isActive: false },
  });

  const unit = await prisma.unit.upsert({
    where: { symbol: "PCS" },
    create: { name: "Pieces", symbol: "PCS" },
    update: {},
  });

  const electronics = await prisma.category.upsert({
    where: { name: "Electronics" },
    create: { name: "Electronics" },
    update: {},
  });
  const packaging = await prisma.category.upsert({
    where: { name: "Packaging" },
    create: { name: "Packaging" },
    update: {},
  });

  const brand = await prisma.brand.upsert({
    where: { name: "StockPilot Gear" },
    create: { name: "StockPilot Gear" },
    update: {},
  });

  const locationDefs = [
    { roomCode: "RM-A", rowCode: "RW-02", rackCode: "RK-05", shelfCode: "SH-03", binCode: "BIN-01" },
    { roomCode: "RM-A", rowCode: "RW-01", rackCode: "RK-01", shelfCode: "SH-04" },
    { roomCode: "RM-B", rowCode: "RW-01", rackCode: "RK-02", shelfCode: "SH-01" },
    { roomCode: "RM-C", rowCode: "RW-04", rackCode: "RK-08", shelfCode: "SH-02" },
  ];

  const locations = [];
  for (const def of locationDefs) {
    const code = [def.roomCode, def.rowCode, def.rackCode, def.shelfCode, def.binCode]
      .filter(Boolean)
      .join("-");
    const barcode = `LOC-${code}`;

    let room = await prisma.room.findFirst({
      where: { warehouseId: warehouse.id, code: def.roomCode },
    });
    if (!room) {
      room = await prisma.room.create({
        data: { warehouseId: warehouse.id, code: def.roomCode, name: def.roomCode },
      });
    }
    let row = await prisma.row.findFirst({ where: { roomId: room.id, code: def.rowCode } });
    if (!row) {
      row = await prisma.row.create({
        data: { roomId: room.id, code: def.rowCode, name: def.rowCode },
      });
    }
    let rack = await prisma.rack.findFirst({ where: { rowId: row.id, code: def.rackCode } });
    if (!rack) {
      rack = await prisma.rack.create({
        data: { rowId: row.id, code: def.rackCode, name: def.rackCode },
      });
    }
    let shelf = await prisma.shelf.findFirst({ where: { rackId: rack.id, code: def.shelfCode } });
    if (!shelf) {
      shelf = await prisma.shelf.create({
        data: { rackId: rack.id, code: def.shelfCode, name: def.shelfCode },
      });
    }
    if (def.binCode) {
      const bin = await prisma.bin.findFirst({ where: { shelfId: shelf.id, code: def.binCode } });
      if (!bin) {
        await prisma.bin.create({
          data: { shelfId: shelf.id, code: def.binCode, name: def.binCode },
        });
      }
    }

    const loc = await prisma.location.upsert({
      where: { code },
      create: {
        warehouseId: warehouse.id,
        code,
        barcode,
        roomCode: def.roomCode,
        rowCode: def.rowCode,
        rackCode: def.rackCode,
        shelfCode: def.shelfCode,
        binCode: def.binCode || null,
        status: "ACTIVE",
      },
      update: {},
    });
    locations.push(loc);
  }

  const productsData = [
    {
      sku: "SCN-X2",
      name: "Barcode Scanner Pro X2",
      categoryId: electronics.id,
      purchasePrice: 120,
      sellingPrice: 189,
      minStock: 10,
      reorderLevel: 25,
      barcode: "SP-SCN-X2-001",
      qty: 120,
      location: locations[0],
    },
    {
      sku: "LBL-4X6",
      name: "Thermal Label Roll 4x6",
      categoryId: packaging.id,
      purchasePrice: 18,
      sellingPrice: 29,
      minStock: 20,
      reorderLevel: 40,
      barcode: "SP-LBL-4X6-001",
      qty: 368,
      location: locations[1],
    },
    {
      sku: "HEX-M8",
      name: "M8 Steel Hex Bolts (Box)",
      categoryId: packaging.id,
      purchasePrice: 8,
      sellingPrice: 14,
      minStock: 15,
      reorderLevel: 30,
      barcode: "SP-HEX-M8-001",
      qty: 6,
      location: locations[2],
    },
  ];

  for (const p of productsData) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      create: {
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        brandId: brand.id,
        unitId: unit.id,
        purchasePrice: p.purchasePrice,
        sellingPrice: p.sellingPrice,
        minStock: p.minStock,
        reorderLevel: p.reorderLevel,
        barcodes: {
          create: { value: p.barcode, symbology: "CODE128", isPrimary: true },
        },
      },
      update: {},
    });

    await prisma.stockBalance.upsert({
      where: {
        productId_locationId_batchNo: {
          productId: product.id,
          locationId: p.location.id,
          batchNo: "",
        },
      },
      create: {
        productId: product.id,
        locationId: p.location.id,
        batchNo: "",
        quantity: p.qty,
      },
      update: { quantity: p.qty },
    });
  }

  for (const key of [
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

  console.log("Seed complete");
  console.log("Admin:", admin.email, "/ Admin@12345");
  // a@gmail.com / Admin@12345
  console.log("Staff:", staff.email, "/ Staff@12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
