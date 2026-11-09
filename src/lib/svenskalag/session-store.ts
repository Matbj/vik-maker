import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireEnv } from "@/lib/env";

const SESSION_SETTING_KEY = "svenskalag_session";
const CIPHER = "aes-256-gcm";

/**
 * The key comes from the login in the env vars, so a changed login makes the
 * saved session unreadable and the client simply logs in again.
 */
function encryptionKey() {
  return scryptSync(requireEnv("SVENSKALAG_PASSWORD"), `svenskalag-session:${requireEnv("SVENSKALAG_USERNAME")}`, 32);
}

function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decrypt(stored: string) {
  const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv(CIPHER, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** The cookies saved by an earlier run, or null when there are none that can be read. */
export async function loadSession(): Promise<Map<string, string> | null> {
  const [row] = await getDb()
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SESSION_SETTING_KEY));
  if (!row) return null;

  try {
    return new Map(JSON.parse(decrypt(row.value)) as [string, string][]);
  } catch {
    return null;
  }
}

export async function saveSession(cookies: Map<string, string>) {
  const value = encrypt(JSON.stringify([...cookies]));
  await getDb()
    .insert(schema.appSettings)
    .values({ key: SESSION_SETTING_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}
