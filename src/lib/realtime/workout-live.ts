import "server-only";
import { createRealtime, rawSql, type SealedLiveQuery } from "@neon/realtime/server";
import { env, requireEnv } from "@/lib/env";

/**
 * Live queries that tell an open workout page when its data changes, through Neon Realtime.
 * They select ids and states only, never names, as the browser receives the rows.
 * The page re-renders on the server when any of them changes.
 */
const WORKOUT_QUERIES = {
  // The save's lease and error text are left out: the first changes without anything to show.
  workout:
    "SELECT id, synced_at, starts_at, location, live_started_at, presence_version, presence_pushed_version, presence_pushed_at, presence_push_error IS NOT NULL AS presence_push_failed FROM workouts WHERE id = $1::uuid",
  players:
    "SELECT player_id, player_response, coach_check FROM workout_attendance WHERE workout_id = $1::uuid",
  coaches:
    "SELECT coach_id, response, coach_check FROM workout_coach_attendance WHERE workout_id = $1::uuid",
  groups:
    "SELECT id, kind, name, level_codes, league, sort_order FROM workout_groups WHERE workout_id = $1::uuid",
  members:
    "SELECT m.group_id, m.player_id, m.added_late FROM workout_group_members m JOIN workout_groups g ON g.id = m.group_id WHERE g.workout_id = $1::uuid",
} as const;

export type WorkoutLiveQueries = Record<keyof typeof WORKOUT_QUERIES, SealedLiveQuery<unknown>>;

let realtime: ReturnType<typeof createRealtime> | undefined;

/** Realtime is optional, so the page works without it, only without live updates. */
export function realtimeUrl() {
  return env.NEON_REALTIME_URL && env.NEON_REALTIME_SECRET ? env.NEON_REALTIME_URL : null;
}

/**
 * Seals the workout's live queries. Sealed queries expire after a minute and work for
 * anyone holding them, so only call this for a logged-in coach.
 */
export async function sealWorkoutLiveQueries(workoutId: string): Promise<WorkoutLiveQueries | null> {
  if (!realtimeUrl()) return null;
  try {
    realtime ??= createRealtime({
      secret: requireEnv("NEON_REALTIME_SECRET"),
      // The database name, not the connection string.
      db: new URL(requireEnv("DATABASE_URL")).pathname.slice(1),
      debugMode: process.env.NODE_ENV === "development",
    });
    const server = realtime;
    const entries = await Promise.all(
      Object.entries(WORKOUT_QUERIES).map(
        async ([name, sql]) => [name, await server.seal({ query: rawSql(sql, [workoutId]) })] as const,
      ),
    );
    return Object.fromEntries(entries) as WorkoutLiveQueries;
  } catch (error) {
    // Live updates are a convenience, so a broken setup must not break the page.
    console.error("Could not seal the workout's live queries", error);
    return null;
  }
}
