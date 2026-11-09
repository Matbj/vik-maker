import "server-only";
import { SvenskalagClient } from "./client";

/**
 * Pulls workouts and attendance for a date range into the database.
 * Placeholder: wired up once SvenskalagClient can actually fetch data.
 * Upserts should key on `workouts.svenskalag_id` and `players.svenskalag_id`.
 */
export async function syncWorkouts(range: { from: Date; to: Date }) {
  const client = new SvenskalagClient();
  const workouts = await client.fetchWorkouts(range);
  // TODO: upsert workouts, then attendance per workout.
  return { workouts: workouts.length };
}
