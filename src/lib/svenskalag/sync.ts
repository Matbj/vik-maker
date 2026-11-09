import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SvenskalagClient } from "./client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recent workouts, so late attendance checks are picked up, plus the coming weeks. */
export function defaultSyncRange(now = new Date()) {
  return { from: new Date(now.getTime() - 14 * DAY_MS), to: new Date(now.getTime() + 28 * DAY_MS) };
}

/**
 * Pulls workouts and attendance for a date range into the database.
 * Upserts key on `workouts.svenskalag_id` and `players.svenskalag_id`.
 * A player's level and active flag belong to the coaches and are never touched here.
 */
export async function syncWorkouts(range: { from: Date; to: Date }) {
  const db = getDb();
  const client = new SvenskalagClient();
  const workouts = await client.fetchWorkouts(range);
  const players = new Set<string>();
  let attendanceRows = 0;

  for (const workout of workouts) {
    const attendance = await client.fetchAttendance(workout.id);

    const now = new Date();
    const details = {
      title: workout.title,
      startsAt: workout.startsAt,
      endsAt: workout.endsAt ?? null,
      location: workout.location ?? null,
      syncedAt: now,
    };
    const [{ id: workoutId }] = await db
      .insert(schema.workouts)
      .values({ svenskalagId: workout.id, ...details })
      .onConflictDoUpdate({
        target: schema.workouts.svenskalagId,
        set: { ...details, updatedAt: now },
      })
      .returning({ id: schema.workouts.id });

    if (attendance.length === 0) {
      await db.delete(schema.workoutAttendance).where(eq(schema.workoutAttendance.workoutId, workoutId));
      continue;
    }

    const playerRows = await db
      .insert(schema.players)
      .values(attendance.map((a) => ({ svenskalagId: a.playerSvenskalagId, name: a.playerName })))
      .onConflictDoUpdate({
        target: schema.players.svenskalagId,
        set: { name: sql`excluded.name`, updatedAt: now },
      })
      .returning({ id: schema.players.id, svenskalagId: schema.players.svenskalagId });
    const playerIds = new Map(playerRows.map((p) => [p.svenskalagId, p.id]));

    await db
      .insert(schema.workoutAttendance)
      .values(
        attendance.map((a) => ({
          workoutId,
          playerId: playerIds.get(a.playerSvenskalagId)!,
          playerResponse: a.playerResponse,
          coachCheck: a.coachCheck,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.workoutAttendance.workoutId, schema.workoutAttendance.playerId],
        set: {
          playerResponse: sql`excluded.player_response`,
          coachCheck: sql`excluded.coach_check`,
          updatedAt: now,
        },
      });

    // Answers removed on svenskalag.se disappear here too.
    await db
      .delete(schema.workoutAttendance)
      .where(
        and(
          eq(schema.workoutAttendance.workoutId, workoutId),
          notInArray(schema.workoutAttendance.playerId, [...playerIds.values()]),
        ),
      );

    attendance.forEach((a) => players.add(a.playerSvenskalagId));
    attendanceRows += attendance.length;
  }

  return { workouts: workouts.length, players: players.size, attendanceRows };
}
