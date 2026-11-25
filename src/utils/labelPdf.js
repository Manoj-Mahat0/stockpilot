const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");

/**
 * One printable PDF page grid of barcode labels (A4, 2 columns).
 */
async function buildLabelsPdf(labels) {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(14).fillColor("#001637").text("STOCKPILOT — Barcode Labels", { align: "center" });
  doc.moveDown(0.35);
  doc
    .fontSize(9)
    .fillColor("#555")
    .text(`Generated ${new Date().toLocaleString()}  ·  ${labels.length} label(s)`, { align: "center" });
  doc.fillColor("#000").moveDown(0.8);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = pageWidth / 2 - 8;
  let col = 0;
  let y = doc.y;

  for (const label of labels) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
      col = 0;
    }

    const x = doc.page.margins.left + col * (colW + 16);
    // eslint-disable-next-line no-await-in-loop
    await drawLabelBox(doc, x, y, colW, label);

    col += 1;
    if (col >= 2) {
      col = 0;
      y += 150;
    }
  }

  doc.end();
  return done;
}

async function drawLabelBox(doc, x, y, w, label) {
  doc.save();
  doc.roundedRect(x, y, w, 140, 6).stroke("#172B4D");

  doc.fontSize(10).fillColor("#001637").text(label.productName || "Product", x + 8, y + 8, {
    width: w - 16,
    ellipsis: true,
  });
  doc.fontSize(8).fillColor("#555").text(`SKU: ${label.sku || "—"}`, x + 8, y + 24, {
    width: w - 16,
  });

  const barcodeY = y + 40;
  try {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: String(label.barcodeValue || ""),
      scale: 2,
      height: 12,
      includetext: false,
    });
    doc.image(png, x + 12, barcodeY, { width: w - 24, height: 42 });
  } catch {
    doc.fontSize(11).fillColor("#000").text(label.barcodeValue || "", x + 8, barcodeY + 12, {
      width: w - 16,
      align: "center",
    });
  }

  doc
    .fontSize(9)
    .fillColor("#000")
    .text(label.barcodeValue || "", x + 8, barcodeY + 46, { width: w - 16, align: "center" });

  const meta = [
    label.rack ? `Rack: ${label.rack}` : null,
    label.vendor ? `Vendor: ${label.vendor}` : null,
    label.unitCost != null && label.unitCost !== "" ? `Rate: ${label.unitCost}` : null,
    label.batchNo ? `Batch: ${label.batchNo}` : null,
    label.manufactureDate ? `MFG: ${fmtDate(label.manufactureDate)}` : null,
    label.expiryDate ? `EXP: ${fmtDate(label.expiryDate)}` : null,
    label.grnNo ? `GRN: ${label.grnNo}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  doc.fontSize(7).fillColor("#444").text(meta, x + 8, y + 112, {
    width: w - 16,
    height: 22,
    ellipsis: true,
  });
  doc.restore();
}

function fmtDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function toLabelPayload(item, session) {
  return {
    barcodeValue: item.barcodeValue,
    productName: item.product?.name,
    sku: item.product?.sku,
    rack: item.location?.code,
    vendor: session?.vendor?.name,
    unitCost: item.unitCost,
    batchNo: item.batchNo,
    manufactureDate: item.manufactureDate,
    expiryDate: item.expiryDate,
    grnNo: session?.grnNo,
  };
}

module.exports = { buildLabelsPdf, toLabelPayload };
