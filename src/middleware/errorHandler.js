const { ZodError } = require("zod");
const { AppError } = require("../utils/errors");

function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  if (err.code === "P2002") {
    return res.status(409).json({
      error: "Duplicate value violates unique constraint",
      code: "UNIQUE_CONSTRAINT",
      meta: err.meta,
    });
  }

  console.error(err);
  return res.status(500).json({
    error: err?.message || "Internal server error",
    code: "INTERNAL",
    name: err?.name,
    meta: err?.meta,
  });
}

module.exports = { errorHandler };
