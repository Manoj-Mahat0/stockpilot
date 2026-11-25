/**
 * Build challan/invoice PDF. Prefer pdfkit; fall back to a minimal PDF
 * so Vercel serverless still returns a printable file if fonts are missing.
 */
async function buildDocumentPdf(doc) {
  try {
    return await buildWithPdfKit(doc);
  } catch (err) {
    console.error("pdfkit failed, using fallback PDF:", err?.message || err);
    return buildMinimalPdf(doc);
  }
}

async function buildWithPdfKit(doc) {
  const PDFDocument = require("pdfkit");
  const chunks = [];
  const pdf = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: true });
  pdf.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  // Standard fonts only (no custom TTF) — works when AFM data is present
  pdf.font("Helvetica-Bold").fontSize(18).fillColor("#001637").text("STOCKPILOT");
  pdf.font("Helvetica-Bold").fontSize(14).fillColor("#000000").text(doc.type === "INVOICE" ? "TAX INVOICE" : "DELIVERY CHALLAN");
  pdf.moveDown(0.5);
  pdf.font("Helvetica").fontSize(10);
  pdf.text(`Document No: ${doc.docNo || ""}`);
  pdf.text(`Date: ${formatDate(doc.createdAt)}`);
  pdf.text(`Site: ${doc.site?.name || ""} (${doc.site?.code || ""})`);
  if (doc.stockEntry?.destinationSite) {
    pdf.text(
      `Destination: ${doc.stockEntry.destinationSite.name} (${doc.stockEntry.destinationSite.code})`
    );
  }
  if (doc.type === "INVOICE") {
    pdf.text(`Customer: ${doc.customerName || "—"}`);
    if (doc.customerPhone) pdf.text(`Phone: ${doc.customerPhone}`);
    if (doc.customerGstin) pdf.text(`GSTIN: ${doc.customerGstin}`);
  }
  pdf.moveDown();
  pdf.font("Helvetica-Bold").fontSize(11).text("Items");
  pdf.moveDown(0.3);
  pdf.font("Helvetica").fontSize(9);

  const lines = Array.isArray(doc.lineSnapshot) ? doc.lineSnapshot : [];
  lines.forEach((l, i) => {
    const row =
      `${i + 1}. ${l.name || ""} [${l.sku || ""}]  Qty: ${l.quantity}  Wt: ${l.weight || 0}` +
      (doc.type === "INVOICE" ? `  Rate: ${l.rate || 0}  Amt: ${l.amount || 0}` : "");
    pdf.text(row);
  });

  if (doc.type === "INVOICE") {
    pdf.moveDown();
    pdf.text(`Subtotal: ${doc.subtotal}`);
    pdf.text(`GST (${doc.gstRate}%): ${doc.gstAmount}`);
    pdf.font("Helvetica-Bold").fontSize(11).text(`Total: ${doc.totalAmount}`);
  }

  if (doc.remarks) {
    pdf.moveDown();
    pdf.font("Helvetica").fontSize(9).text(`Remarks: ${doc.remarks}`);
  }

  pdf.moveDown(2);
  pdf.text("Authorised Signature: ____________________");
  pdf.end();
  return done;
}

function buildMinimalPdf(doc) {
  const lines = Array.isArray(doc.lineSnapshot) ? doc.lineSnapshot : [];
  const title = doc.type === "INVOICE" ? "TAX INVOICE" : "DELIVERY CHALLAN";
  const body = [
    "STOCKPILOT",
    title,
    `Document No: ${doc.docNo || ""}`,
    `Date: ${formatDate(doc.createdAt)}`,
    `Site: ${doc.site?.name || ""} (${doc.site?.code || ""})`,
    doc.stockEntry?.destinationSite
      ? `Destination: ${doc.stockEntry.destinationSite.name} (${doc.stockEntry.destinationSite.code})`
      : null,
    doc.type === "INVOICE" ? `Customer: ${doc.customerName || "—"}` : null,
    "",
    "Items:",
    ...lines.map(
      (l, i) =>
        `${i + 1}. ${l.name || ""} [${l.sku || ""}] Qty:${l.quantity} Wt:${l.weight || 0}` +
        (doc.type === "INVOICE" ? ` Rate:${l.rate || 0} Amt:${l.amount || 0}` : "")
    ),
    doc.type === "INVOICE" ? `Subtotal: ${doc.subtotal}` : null,
    doc.type === "INVOICE" ? `GST (${doc.gstRate}%): ${doc.gstAmount}` : null,
    doc.type === "INVOICE" ? `Total: ${doc.totalAmount}` : null,
    doc.remarks ? `Remarks: ${doc.remarks}` : null,
    "",
    "Authorised Signature: ____________________",
  ]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");

  const esc = (s) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, "?");

  const textLines = body.split("\n").map(esc);
  let content = "BT /F1 11 Tf 50 780 Td 14 TL\n";
  textLines.forEach((line, i) => {
    content += i === 0 ? `(${line}) Tj\n` : `T* (${line}) Tj\n`;
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

function formatDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(d || "");
  }
}

module.exports = { buildDocumentPdf };
