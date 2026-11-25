/**
 * Product QR-code labels PDF — real scannable QR images via pdf-lib + qrcode.
 * Works on Vercel (no pdfkit font files required).
 */
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const QRCode = require("qrcode");

async function buildLabelsPdf(labels) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 36;
  const gap = 12;
  const cols = 2;
  const colW = (pageW - margin * 2 - gap) / cols;
  const rowH = 168;
  const qrSize = 88;

  let page = pdfDoc.addPage([pageW, pageH]);
  let col = 0;
  let yTop = pageH - margin;

  // Header on first page
  page.drawText("STOCKPILOT — QR Code Labels", {
    x: margin,
    y: yTop - 14,
    size: 14,
    font: fontBold,
    color: rgb(0, 0.086, 0.216),
  });
  page.drawText(`Generated ${new Date().toISOString().slice(0, 19)}  ·  ${labels.length} label(s)`, {
    x: margin,
    y: yTop - 30,
    size: 9,
    font,
    color: rgb(0.33, 0.33, 0.33),
  });
  yTop -= 48;

  for (const label of labels) {
    if (yTop - rowH < margin) {
      page = pdfDoc.addPage([pageW, pageH]);
      yTop = pageH - margin;
      col = 0;
    }

    const x = margin + col * (colW + gap);
    const y = yTop - rowH;

    // Card border
    page.drawRectangle({
      x,
      y,
      width: colW,
      height: rowH - 8,
      borderColor: rgb(0.09, 0.17, 0.3),
      borderWidth: 1,
    });

    const name = String(label.productName || "Product").slice(0, 36);
    const sku = String(label.sku || "—");
    const code = String(label.barcodeValue || "");

    page.drawText(name, {
      x: x + 8,
      y: y + rowH - 28,
      size: 10,
      font: fontBold,
      color: rgb(0, 0.086, 0.216),
      maxWidth: colW - 16,
    });
    page.drawText(`SKU: ${sku}`, {
      x: x + 8,
      y: y + rowH - 42,
      size: 8,
      font,
      color: rgb(0.33, 0.33, 0.33),
      maxWidth: colW - 16,
    });

    if (code) {
      const png = await QRCode.toBuffer(code, {
        type: "png",
        width: 240,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      const image = await pdfDoc.embedPng(png);
      const qrX = x + (colW - qrSize) / 2;
      const qrY = y + 28;
      page.drawImage(image, { x: qrX, y: qrY, width: qrSize, height: qrSize });

      const codeW = font.widthOfTextAtSize(code, 8);
      page.drawText(code, {
        x: x + Math.max(8, (colW - codeW) / 2),
        y: y + 14,
        size: 8,
        font,
        color: rgb(0, 0, 0),
        maxWidth: colW - 16,
      });
    }

    col += 1;
    if (col >= cols) {
      col = 0;
      yTop -= rowH;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
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
