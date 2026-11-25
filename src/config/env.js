require("dotenv").config();

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";

const env = {
  port: Number(process.env.PORT || 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  corsOrigin,
  corsOrigins: corsOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
};

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

module.exports = { env };
