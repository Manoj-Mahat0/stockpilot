const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const authService = require("../services/authService");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts", code: "RATE_LIMIT" },
});

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        identifier: z.string().min(1),
        password: z.string().min(1),
        expectedRole: z.enum(["ADMIN", "STAFF"]).optional(),
      })
      .parse(req.body);

    const result = await authService.login(body);
    res.json(result);
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    res.json(await authService.refresh(refreshToken));
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body || {});
    res.json(await authService.logout(refreshToken));
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await authService.me(req.user.id));
  })
);

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .parse(req.body);
    res.json(await authService.changePassword(req.user.id, body.currentPassword, body.newPassword));
  })
);

module.exports = router;
