import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/db";

export const SESSION_COOKIE = "vik_session";

const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Logs the coach in on this browser. Call from a Server Action. */
export async function startSession(coachId: string) {
  const db = getDb();
  const { sessions } = schema;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);

  await db.delete(sessions).where(and(eq(sessions.coachId, coachId), lte(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({ tokenHash: hashToken(token), coachId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Logs this browser out. Call from a Server Action. */
export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

export async function isValidSession(token: string) {
  const { sessions } = schema;
  const [session] = await getDb()
    .select({ coachId: sessions.coachId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return Boolean(session);
}
