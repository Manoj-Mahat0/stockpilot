/**
 * Product QR-code labels PDF.
 * Tries pdfkit+bwip-js; falls back to a simple printable PDF on Vercel.
 */
async function buildLabelsPdf(labels) {
  try {
    return await buildWithPdfKit(labels);
  } catch (err) {
    console.error("label pdfkit failed, using fallback:", err?.message || err);
    return buildMinimalLabelsPdf(labels);
  }
}

async function buildWithPdfKit(labels) {
  const PDFDocument = require("pdfkit");
  let bwipjs = null;
  try {
    bwipjs = require("bwip-js");
  } catch (_) {
    bwipjs = null;
  }

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#001637").text("STOCKPILOT — QR Code Labels", {
    align: "center",
  });
  doc.moveDown(0.35);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#555")
    .text(`Generated ${new Date().toISOString().slice(0, 19)}  ·  ${labels.length} label(s)`, {
      align: "center",
    });
  doc.fillColor("#000").moveDown(0.8);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = pageWidth / 2 - 8;
  const rowH = 170;
  let col = 0;
  let y = doc.y;

  for (const label of labels) {
    if (y > doc.page.height - rowH - 20) {
      doc.addPage();
      y = doc.page.margins.top;
      col = 0;
    }

    const x = doc.page.margins.left + col * (colW + 16);
    // eslint-disable-next-line no-await-in-loop
    await drawLabelBox(doc, x, y, colW, label, bwipjs);

    col += 1;
    if (col >= 2) {
      col = 0;
      y += rowH;
    }
  }

  doc.end();
  return done;
}

async function drawLabelBox(doc, x, y, w, label, bwipjs) {
  doc.save();
  doc.roundedRect(x, y, w, 160, 6).stroke("#172B4D");

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#001637").text(label.productName || "Product", x + 8, y + 8, {
    width: w - 16,
    ellipsis: true,
  });
  doc.font("Helvetica").fontSize(8).fillColor("#555").text(`SKU: ${label.sku || "—"}`, x + 8, y + 24, {
    width: w - 16,
  });

  const qrSize = 72;
  const qrX = x + (w - qrSize) / 2;
  const qrY = y + 38;
  let drew = false;
  if (bwipjs && label.barcodeValue) {
    try {
      const png = await bwipjs.toBuffer({
        bcid: "qrcode",
        text: String(label.barcodeValue),
        scale: 3,
        includetext: false,
      });
      doc.image(png, qrX, qrY, { width: qrSize, height: qrSize });
      drew = true;
    } catch (_) {
      drew = false;
    }
  }
  if (!drew) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(label.barcodeValue || "", x + 8, qrY + 28, {
      width: w - 16,
      align: "center",
    });
  }

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#000")
    .text(label.barcodeValue || "", x + 8, qrY + qrSize + 4, { width: w - 16, align: "center" });

  const meta = [
    label.rack ? `Rack: ${label.rack}` : null,
    label.vendor ? `Vendor: ${label.vendor}` : null,
    label.unitCost != null && label.unitCost !== "" ? `Rate: ${label.unitCost}` : null,
    label.batchNo ? `Batch: ${label.batchNo}` : null,
    label.grnNo ? `GRN: ${label.grnNo}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  if (meta) {
    doc.font("Helvetica").fontSize(7).fillColor("#444").text(meta, x + 8, y + 140, {
      width: w - 16,
      height: 16,
      ellipsis: true,
    });
  }
  doc.restore();
}

function buildMinimalLabelsPdf(labels) {
  const esc = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, "?");

  const rows = [
    "STOCKPILOT - QR Code Labels",
    `Generated ${new Date().toISOString().slice(0, 19)}  |  ${labels.length} label(s)`,
    "",
    ...labels.flatMap((l, i) => [
      `${i + 1}. ${l.productName || "Product"}`,
      `   SKU: ${l.sku || "-"}`,
      `   QR: ${l.barcodeValue || "-"}`,
      "",
    ]),
    "Print this sheet and stick QR codes on products.",
  ];

  let content = "BT /F1 11 Tf 50 800 Td 13 TL\n";
  rows.forEach((line, i) => {
    content += i === 0 ? `(${esc(line)}) Tj\n` : `T* (${esc(line)}) Tj\n`;
  });
  content += "ET";

  const objects = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objects.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n"
  );
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(content, "utf8")} >>stream\n${content}\nendstream\nendobj\n`);
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
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
