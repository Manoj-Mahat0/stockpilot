/**
 * Transfer batch QR PDF — scannable QR + product list for shop receive.
 */
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const QRCode = require("qrcode");

async function buildBatchQrPdf(batch) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 40;
  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const drawText = (text, opts) => {
    page.drawText(String(text || ""), {
      x: margin,
      size: 11,
      font,
      color: rgb(0, 0, 0),
      ...opts,
    });
  };

  drawText("STOCKPILOT — Transfer Batch QR", {
    y: y - 16,
    size: 16,
    font: fontBold,
    color: rgb(0, 0.086, 0.216),
  });
  y -= 36;

  drawText(`Batch: ${batch.batchNo}`, { y: y - 12, size: 12, font: fontBold });
  y -= 20;
  drawText(`From: ${batch.fromSite?.name || batch.fromSiteId}`, { y: y - 12, size: 10 });
  y -= 16;
  drawText(`To: ${batch.toSite?.name || batch.toSiteId}`, { y: y - 12, size: 10 });
  y -= 16;
  drawText(`Status: ${batch.status}`, { y: y - 12, size: 10 });
  y -= 16;
  drawText(`QR: ${batch.qrValue}`, { y: y - 12, size: 10, font: fontBold });
  y -= 28;

  const png = await QRCode.toBuffer(String(batch.qrValue), {
    type: "png",
    width: 360,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const image = await pdfDoc.embedPng(png);
  const qrSize = 200;
  page.drawImage(image, {
    x: (pageW - qrSize) / 2,
    y: y - qrSize,
    width: qrSize,
    height: qrSize,
  });
  y -= qrSize + 24;

  drawText("Products in this batch (shop receives exact qty):", {
    y: y - 12,
    size: 11,
    font: fontBold,
  });
  y -= 22;

  const lines = Array.isArray(batch.lineSnapshot) ? batch.lineSnapshot : [];
  for (let i = 0; i < lines.length; i++) {
    if (y < margin + 40) {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    const l = lines[i];
    drawText(
      `${i + 1}. ${l.name || "Product"}  ·  SKU ${l.sku || "—"}  ·  Qty ${l.quantity}  ·  Wt ${l.weight ?? 0}`,
      { y: y - 11, size: 9 }
    );
    y -= 16;
    if (l.barcode) {
      drawText(`    Product QR: ${l.barcode}`, { y: y - 10, size: 8, color: rgb(0.3, 0.3, 0.3) });
      y -= 14;
    }
  }

  y -= 12;
  drawText("Shop: open Scan → point at this batch QR → Confirm receive.", {
    y: y - 11,
    size: 9,
    color: rgb(0.2, 0.2, 0.2),
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = { buildBatchQrPdf };
