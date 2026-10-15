/**
 * Access code + simple in-memory rate limit for generation.
 * Header: X-Access-Code
 */

const ACCESS_CODE = process.env.ACCESS_CODE || "";

// IP -> { count, resetAt }
const generateHits = new Map();
const GENERATE_LIMIT = 10;
const GENERATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) {
    return xf.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function requireAccessCode(req, res, next) {
  if (!ACCESS_CODE) {
    // Not configured = open (local dev convenience)
    return next();
  }

  const provided =
    req.headers["x-access-code"] ||
    req.headers["x-accesscode"] ||
    "";

  if (String(provided) !== String(ACCESS_CODE)) {
    return res.status(401).json({
      error:
        "Invalid or missing access code. Enter the correct code to use SideHustle.",
    });
  }
  return next();
}

function rateLimitGenerate(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  let entry = generateHits.get(ip);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + GENERATE_WINDOW_MS };
    generateHits.set(ip, entry);
  }

  if (entry.count >= GENERATE_LIMIT) {
    const mins = Math.max(1, Math.ceil((entry.resetAt - now) / 60000));
    return res.status(429).json({
      error: `Generation limit reached (10 per hour). Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
    });
  }

  entry.count += 1;
  generateHits.set(ip, entry);

  res.setHeader("X-RateLimit-Limit", String(GENERATE_LIMIT));
  res.setHeader(
    "X-RateLimit-Remaining",
    String(Math.max(0, GENERATE_LIMIT - entry.count))
  );
  res.setHeader("X-RateLimit-Reset", String(Math.floor(entry.resetAt / 1000)));

  return next();
}

/** Optional: clear stale map entries occasionally */
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of generateHits.entries()) {
    if (now >= entry.resetAt) generateHits.delete(ip);
  }
}, 15 * 60 * 1000).unref?.();

module.exports = {
  requireAccessCode,
  rateLimitGenerate,
  ACCESS_CODE_CONFIGURED: Boolean(ACCESS_CODE),
};