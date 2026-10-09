import { createHmac } from "node:crypto";

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

/**
 * Hosted Redis (Upstash). Vercel's Upstash integration injects KV_REST_API_*;
 * the UPSTASH_REDIS_REST_* names are accepted too.
 */
export function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

let warnedAboutDevSecret = false;

/**
 * Secret used to sign the session cookie.
 *  1. SESSION_SECRET if set (recommended).
 *  2. Otherwise derived from the Redis token, so a Vercel deploy works with no extra setup.
 *  3. Otherwise, outside production only, a fixed development secret.
 */
export function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const redis = redisConfig();
  if (redis) {
    return createHmac("sha256", redis.token).update("reception-session-secret-v1").digest("hex");
  }
  if (!isProduction()) {
    if (!warnedAboutDevSecret) {
      warnedAboutDevSecret = true;
      console.warn("[auth] SESSION_SECRET is not set; using an insecure development secret.");
    }
    return "development-only-session-secret-do-not-use-in-production";
  }
  throw new Error("SESSION_SECRET must be configured before authentication is used.");
}
