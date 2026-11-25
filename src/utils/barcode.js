/**
 * Generate a unique primary barcode for a product SKU.
 * Format: SP-{SKU}-{6 digit sequence from timestamp}
 */
function generateProductBarcode(sku) {
  const clean = String(sku || "ITEM")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16) || "ITEM";
  const tail = Date.now().toString().slice(-6);
  return `SP-${clean}-${tail}`;
}

module.exports = { generateProductBarcode };
