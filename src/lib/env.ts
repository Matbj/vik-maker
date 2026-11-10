import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Read lazily so `next build` works without
 * secrets present; each getter throws a clear error when a value is missing.
 */
const schema = z.object({
  DATABASE_URL: z.string().url().optional(),
  SVENSKALAG_BASE_URL: z.string().url().default("https://www.svenskalag.se"),
  SVENSKALAG_TEAM_PATH: z.string().default("/vendelsoik-p10"),
  SVENSKALAG_USERNAME: z.string().optional(),
  SVENSKALAG_PASSWORD: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  CLAUDE_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("VIK Playmaker <playmaker@mail.blund.tech>"),
  NEON_REALTIME_URL: z.string().url().optional(),
  NEON_REALTIME_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${key}. See .env.example.`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
