const fs = require("fs");
const path = require("path");
const { app } = require("./app");
const { env } = require("./config/env");

const uploadPath = path.join(process.cwd(), env.uploadDir);
if (!fs.existsSync(uploadPath)) {
  try {
    fs.mkdirSync(uploadPath, { recursive: true });
  } catch {
    // Ignore on read-only serverless filesystems (Vercel)
  }
}

// Local / traditional Node host only — Vercel uses api/index.js
if (!process.env.VERCEL) {
  app.listen(env.port, () => {
    console.log(`StockPilot backend running on http://localhost:${env.port}`);
  });
}

module.exports = app;
