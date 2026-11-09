import "server-only";
import { createHash, randomInt } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env, requireEnv } from "@/lib/env";

/** Letters and digits, without the ones that are easy to mix up (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
export const MAX_ATTEMPTS = 3;
const CODE_TTL_MS = 10 * 60 * 1000;
/** With three guesses per code, this is what keeps a four-character code from being brute-forced. */
const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

function hashCode(coachId: string, code: string) {
  return createHash("sha256").update(`${coachId}:${code}`).digest("hex");
}

export function normalizeCode(code: string) {
  return code.replace(/\s/g, "").toUpperCase();
}

async function findCoach(email: string) {
  const { coaches } = schema;
  const [coach] = await getDb()
    .select({ id: coaches.id })
    .from(coaches)
    .where(eq(coaches.email, email.trim().toLowerCase()))
    .orderBy(coaches.name)
    .limit(1);
  return coach;
}

/**
 * Emails a new code if the address belongs to a coach, replacing any earlier code.
 * Says nothing about whether it did, so the login form can't be used to test addresses.
 */
export async function sendLoginCode(email: string) {
  const db = getDb();
  const { loginCodes } = schema;
  const coach = await findCoach(email);
  if (!coach) return;

  const now = new Date();
  const [previous] = await db.select().from(loginCodes).where(eq(loginCodes.coachId, coach.id));
  const inWindow = previous && now.getTime() - previous.sendWindowStartedAt.getTime() < HOUR_MS;
  if (inWindow && previous.sendCount >= MAX_SENDS_PER_HOUR) return;

  const code = generateCode();
  const fields = {
    codeHash: hashCode(coach.id, code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    sendCount: inWindow ? previous.sendCount + 1 : 1,
    sendWindowStartedAt: inWindow ? previous.sendWindowStartedAt : now,
  };
  await db
    .insert(loginCodes)
    .values({ coachId: coach.id, ...fields })
    .onConflictDoUpdate({ target: loginCodes.coachId, set: fields });

  await emailCode(email.trim().toLowerCase(), code);
}

async function emailCode(to: string, code: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to,
      subject: `Din kod till VIK Playmaker: ${code}`,
      text: `Din inloggningskod är ${code}\n\nDen gäller i 10 minuter. Om du inte har bett om den kan du ignorera det här mejlet.`,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

export type CodeCheck = { status: "ok"; coachId: string } | { status: "wrong" } | { status: "invalid" };

/**
 * Checks a code. The attempt is counted first in one statement, so simultaneous
 * guesses can't get past the limit. The third wrong attempt uses the code up.
 */
export async function checkLoginCode(email: string, code: string): Promise<CodeCheck> {
  const db = getDb();
  const { loginCodes } = schema;
  const coach = await findCoach(email);
  if (!coach) return { status: "wrong" };

  const [row] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(
      and(
        eq(loginCodes.coachId, coach.id),
        lt(loginCodes.attempts, MAX_ATTEMPTS),
        gt(loginCodes.expiresAt, new Date()),
      ),
    )
    .returning({ codeHash: loginCodes.codeHash, attempts: loginCodes.attempts });
  if (!row) return { status: "invalid" };

  const codeHash = hashCode(coach.id, normalizeCode(code));
  if (row.codeHash !== codeHash) {
    return row.attempts >= MAX_ATTEMPTS ? { status: "invalid" } : { status: "wrong" };
  }

  const used = await db
    .delete(loginCodes)
    .where(and(eq(loginCodes.coachId, coach.id), eq(loginCodes.codeHash, codeHash)))
    .returning({ coachId: loginCodes.coachId });
  return used.length > 0 ? { status: "ok", coachId: coach.id } : { status: "invalid" };
}
