const path = require("path");
const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const { errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const productRoutes = require("./routes/products");
const locationRoutes = require("./routes/locations");
const stockRoutes = require("./routes/stock");
const barcodeRoutes = require("./routes/barcodes");
const auditRoutes = require("./routes/audits");
const dashboardRoutes = require("./routes/dashboard");
const reportRoutes = require("./routes/reports");
const notificationRoutes = require("./routes/notifications");
const settingsRoutes = require("./routes/settings");
const catalogRoutes = require("./routes/catalog");
const siteRoutes = require("./routes/sites");
const entryRoutes = require("./routes/entries");
const siteStockRoutes = require("./routes/siteStock");
const documentRoutes = require("./routes/documents");

const app = express();

const allowedOrigins = new Set([
  ...env.corsOrigins,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      // Allow Vercel preview / production frontends
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), env.uploadDir)));

app.get("/", (_req, res) => {
  res.json({
    name: "StockPilot API",
    tagline: "Scan. Track. Control. Everything in Stock.",
    status: "ok",
    version: "1.0.0",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/products", productRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/entries", entryRoutes);
app.use("/api/site-stock", siteStockRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/barcodes", barcodeRoutes);
app.use("/api/audits", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/settings", settingsRoutes);

app.use(errorHandler);

module.exports = { app };
