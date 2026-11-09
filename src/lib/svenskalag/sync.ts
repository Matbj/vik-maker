import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SvenskalagClient } from "./client";
import type { SvenskalagAttendance } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recent workouts, so late attendance checks are picked up, plus the coming weeks. */
export function defaultSyncRange(now = new Date()) {
  return { from: new Date(now.getTime() - 14 * DAY_MS), to: new Date(now.getTime() + 28 * DAY_MS) };
}

/**
 * Pulls workouts and attendance for a date range into the database.
 * Upserts key on the svenskalag ids of workouts, players and coaches.
 * A player's level and active flag belong to the coaches and are never touched here.
 */
export async function syncWorkouts(range: { from: Date; to: Date }) {
  const db = getDb();
  const client = new SvenskalagClient();
  const workouts = await client.fetchWorkouts(range);
  const players = new Set<string>();
  const coaches = new Set<string>();
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

    const playerAttendance = attendance.filter((a) => a.role === "player");
    const coachAttendance = attendance.filter((a) => a.role === "coach");
    await syncPlayerAttendance(workoutId, playerAttendance, now);
    await syncCoachAttendance(workoutId, coachAttendance, now);

    playerAttendance.forEach((a) => players.add(a.memberSvenskalagId));
    coachAttendance.forEach((a) => coaches.add(a.memberSvenskalagId));
    attendanceRows += attendance.length;
  }

  // After the attendance, so coaches seen for the first time get their email too.
  const coachEmails = await syncCoachEmails(client);

  return { workouts: workouts.length, players: players.size, coaches: coaches.size, attendanceRows, coachEmails };
}

/**
 * Copies emails from svenskalag.se's contact list onto the coaches we know, matched by name.
 * Someone no longer listed as a coach loses their email, and with it the ability to log in.
 */
export async function syncCoachEmails(client = new SvenskalagClient()) {
  const db = getDb();
  const { coaches } = schema;
  const contacts = await client.fetchCoachContacts();
  const emails = new Map(contacts.map((c) => [normalizeName(c.name), c.email]));

  const known = await db.select({ id: coaches.id, name: coaches.name, email: coaches.email }).from(coaches);
  let updated = 0;
  for (const coach of known) {
    const email = emails.get(normalizeName(coach.name)) ?? null;
    if (email === coach.email) continue;
    await db.update(coaches).set({ email }).where(eq(coaches.id, coach.id));
    updated++;
  }

  const withEmail = known.filter((c) => emails.get(normalizeName(c.name))).length;
  return { coaches: known.length, withEmail, updated, listedOnSvenskalag: contacts.length };
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Re-reads one workout's attendance from svenskalag.se. */
export async function refreshWorkoutAttendance(workoutId: string, svenskalagId: string) {
  const attendance = await new SvenskalagClient().fetchAttendance(svenskalagId);
  const now = new Date();
  await syncPlayerAttendance(workoutId, attendance.filter((a) => a.role === "player"), now);
  await syncCoachAttendance(workoutId, attendance.filter((a) => a.role === "coach"), now);
  await getDb()
    .update(schema.workouts)
    .set({ syncedAt: now, updatedAt: now })
    .where(eq(schema.workouts.id, workoutId));
}

async function syncPlayerAttendance(workoutId: string, attendance: SvenskalagAttendance[], now: Date) {
  const db = getDb();
  const { players, workoutAttendance } = schema;
  if (attendance.length === 0) {
    await db.delete(workoutAttendance).where(eq(workoutAttendance.workoutId, workoutId));
    return;
  }

  const rows = await db
    .insert(players)
    .values(attendance.map((a) => ({ svenskalagId: a.memberSvenskalagId, name: a.memberName })))
    .onConflictDoUpdate({
      target: players.svenskalagId,
      set: { name: sql`excluded.name`, updatedAt: now },
    })
    .returning({ id: players.id, svenskalagId: players.svenskalagId });
  const ids = new Map(rows.map((p) => [p.svenskalagId, p.id]));

  await db
    .insert(workoutAttendance)
    .values(
      attendance.map((a) => ({
        workoutId,
        playerId: ids.get(a.memberSvenskalagId)!,
        playerResponse: a.response,
        coachCheck: a.coachCheck,
      })),
    )
    .onConflictDoUpdate({
      target: [workoutAttendance.workoutId, workoutAttendance.playerId],
      set: {
        playerResponse: sql`excluded.player_response`,
        coachCheck: sql`excluded.coach_check`,
        updatedAt: now,
      },
    });

  // Answers removed on svenskalag.se disappear here too.
  await db
    .delete(workoutAttendance)
    .where(
      and(
        eq(workoutAttendance.workoutId, workoutId),
        notInArray(workoutAttendance.playerId, [...ids.values()]),
      ),
    );
}

async function syncCoachAttendance(workoutId: string, attendance: SvenskalagAttendance[], now: Date) {
  const db = getDb();
  const { coaches, workoutCoachAttendance } = schema;
  if (attendance.length === 0) {
    await db.delete(workoutCoachAttendance).where(eq(workoutCoachAttendance.workoutId, workoutId));
    return;
  }

  const rows = await db
    .insert(coaches)
    .values(attendance.map((a) => ({ svenskalagId: a.memberSvenskalagId, name: a.memberName })))
    .onConflictDoUpdate({
      target: coaches.svenskalagId,
      set: { name: sql`excluded.name`, updatedAt: now },
    })
    .returning({ id: coaches.id, svenskalagId: coaches.svenskalagId });
  const ids = new Map(rows.map((c) => [c.svenskalagId, c.id]));

  await db
    .insert(workoutCoachAttendance)
    .values(
      attendance.map((a) => ({
        workoutId,
        coachId: ids.get(a.memberSvenskalagId)!,
        response: a.response,
        coachCheck: a.coachCheck,
      })),
    )
    .onConflictDoUpdate({
      target: [workoutCoachAttendance.workoutId, workoutCoachAttendance.coachId],
      set: {
        response: sql`excluded.response`,
        coachCheck: sql`excluded.coach_check`,
        updatedAt: now,
      },
    });

  await db
    .delete(workoutCoachAttendance)
    .where(
      and(
        eq(workoutCoachAttendance.workoutId, workoutId),
        notInArray(workoutCoachAttendance.coachId, [...ids.values()]),
      ),
    );
}
