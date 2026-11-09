import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | undefined;

/** Lazily created so builds and pages that don't touch the DB need no DATABASE_URL. */
export function getDb() {
  if (!_db) {
    _db = drizzle(neon(requireEnv("DATABASE_URL")), { schema });
  }
  return _db;
}

export { schema };
