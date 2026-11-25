try {
  const { app } = require("../src/app");
  module.exports = app;
} catch (err) {
  console.error("StockPilot API boot failure:", err);
  module.exports = (req, res) => {
    res.status(500).json({
      error: "API boot failed",
      message: err?.message || String(err),
    });
  };
}
