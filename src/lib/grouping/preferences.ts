import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PlayerPair } from "./level-groups";

export const GROUPING_NOTES_KEY = "grouping_notes";

/** The coaches' standing wishes from Settings, applied to all grouping. */
export async function loadGroupingPreferences() {
  const db = getDb();
  const [pairs, [notes]] = await Promise.all([
    db.select().from(schema.playerSeparations),
    db.select().from(schema.appSettings).where(eq(schema.appSettings.key, GROUPING_NOTES_KEY)),
  ]);
  return {
    keepApart: pairs.map((pair): PlayerPair => [pair.playerAId, pair.playerBId]),
    notes: notes?.value ?? "",
  };
}
