import "server-only";
import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SvenskalagClient } from "./client";
import { presencePushEnabled, pushPresence } from "./presence";
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
    // First, so what the coaches filled in here isn't replaced by an older list read below.
    let presence = await loadPresenceState(workout.id);
    if (presence.started && presence.version !== presence.pushedVersion) {
      await pushPresence(presence.workoutId);
      presence = await loadPresenceState(workout.id);
    }
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
    const checks = checkPolicy(workoutId, presence, attendance);
    await syncPlayerAttendance(workoutId, playerAttendance, now, checks);
    await syncCoachAttendance(workoutId, coachAttendance, now, checks);
    await followPushedIds(checks, attendance);

    playerAttendance.forEach((a) => players.add(a.memberSvenskalagId));
    coachAttendance.forEach((a) => coaches.add(a.memberSvenskalagId));
    attendanceRows += attendance.length;
  }

  // After the attendance, so coaches seen for the first time get their contact details too,
  // and renamed coaches still match the contact list before anything is cleared.
  const coachContacts = await syncCoachContacts({ client, clearMissing: true });

  return { workouts: workouts.length, players: players.size, coaches: coaches.size, attendanceRows, coachContacts };
}

/**
 * Copies emails, phone numbers and roles from svenskalag.se's contact list onto the coaches we know, matched by name.
 * With `clearMissing`, someone no longer listed as a coach loses them all, and with the email the ability to log in.
 * Only do that right after the attendance has refreshed the names, or a renamed coach looks like a removed one.
 */
export async function syncCoachContacts({
  client = new SvenskalagClient(),
  clearMissing = false,
}: { client?: SvenskalagClient; clearMissing?: boolean } = {}) {
  const db = getDb();
  const { coaches } = schema;
  const contacts = await client.fetchCoachContacts();
  const byName = new Map(contacts.map((c) => [normalizeName(c.name), c]));

  const known = await db
    .select({ id: coaches.id, name: coaches.name, email: coaches.email, phone: coaches.phone, role: coaches.role })
    .from(coaches);
  let updated = 0;
  let withEmail = 0;
  let withPhone = 0;
  for (const coach of known) {
    const contact = byName.get(normalizeName(coach.name));
    const fallback = clearMissing ? { email: null, phone: null, role: null } : coach;
    const email = contact?.email ?? fallback.email;
    const phone = contact?.phone ?? fallback.phone;
    const role = contact?.role ?? fallback.role;
    if (email) withEmail++;
    if (phone) withPhone++;
    if (email === coach.email && phone === coach.phone && role === coach.role) continue;
    await db.update(coaches).set({ email, phone, role }).where(eq(coaches.id, coach.id));
    updated++;
  }

  return { coaches: known.length, withEmail, withPhone, updated, listedOnSvenskalag: contacts.length };
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Re-reads one workout's attendance from svenskalag.se. */
export async function refreshWorkoutAttendance(workoutId: string, svenskalagId: string) {
  const db = getDb();
  const client = new SvenskalagClient();
  const presence = await loadPresenceState(svenskalagId);
  const attendance = await client.fetchAttendance(svenskalagId);
  const checks = checkPolicy(workoutId, presence, attendance);
  const coachAttendance = attendance.filter((a) => a.role === "coach");
  const coachIds = [...new Set(coachAttendance.map((a) => a.memberSvenskalagId))];
  const known = await db
    .select({ svenskalagId: schema.coaches.svenskalagId })
    .from(schema.coaches)
    .where(inArray(schema.coaches.svenskalagId, coachIds));

  const now = new Date();
  await syncPlayerAttendance(workoutId, attendance.filter((a) => a.role === "player"), now, checks);
  await syncCoachAttendance(workoutId, coachAttendance, now, checks);
  await followPushedIds(checks, attendance);
  await db
    .update(schema.workouts)
    .set({ syncedAt: now, updatedAt: now })
    .where(eq(schema.workouts.id, workoutId));

  // A coach seen for the first time needs their email to be able to log in.
  if (known.length < coachIds.length) {
    try {
      await syncCoachContacts({ client });
    } catch (err) {
      console.error("coach contact sync failed, the daily sync will retry:", err);
    }
  }
}

type PresenceState =
  | { started: false }
  | { started: true; workoutId: string; version: number; pushedVersion: number };

/** Whether the coaches fill in the workout's attendance here, read before fetching from svenskalag.se. */
async function loadPresenceState(svenskalagId: string): Promise<PresenceState> {
  const { workouts } = schema;
  const [workout] = await getDb()
    .select({
      id: workouts.id,
      liveStartedAt: workouts.liveStartedAt,
      version: workouts.presenceVersion,
      pushedVersion: workouts.presencePushedVersion,
    })
    .from(workouts)
    .where(eq(workouts.svenskalagId, svenskalagId));
  if (!workout?.liveStartedAt) return { started: false };
  return { started: true, workoutId: workout.id, version: workout.version, pushedVersion: workout.pushedVersion };
}

/**
 * How a sync treats the coaches' check. Until a workout is started it follows svenskalag.se.
 * After that the check is ours and saved there, so svenskalag.se's is only taken when it has
 * one and none of ours is waiting to be saved, which `guard` tests in the same statement as
 * the write. The answers always follow svenskalag.se.
 */
type CheckPolicy = {
  started: boolean;
  /** SQL for whether to take svenskalag.se's check over ours. */
  guard: SQL;
  /** Set when our last save should be remembered as what svenskalag.se holds now. */
  follow?: { workoutId: string; version: number };
};

function checkPolicy(workoutId: string, presence: PresenceState, attendance: SvenskalagAttendance[]): CheckPolicy {
  if (!presence.started) return { started: false, guard: sql`true` };
  // Nothing registered there, such as before our first save, or always where saving is off.
  if (!attendance.some((a) => a.coachCheck !== null)) return { started: true, guard: sql`false` };
  // Where saving is off nothing of ours is ever waiting, so svenskalag.se stays the source.
  if (!presencePushEnabled()) return { started: true, guard: sql`true` };

  const { workouts } = schema;
  const { version } = presence;
  return {
    started: true,
    guard: sql`(select ${workouts.presenceVersion} = ${version} and ${workouts.presencePushedVersion} = ${version} from ${workouts} where ${workouts.id} = ${workoutId})`,
    follow: { workoutId, version },
  };
}

/** After taking svenskalag.se's check, a later save compares against that list. */
async function followPushedIds({ follow }: CheckPolicy, attendance: SvenskalagAttendance[]) {
  if (!follow) return;
  const { workouts } = schema;
  await getDb()
    .update(workouts)
    .set({
      presencePushedIds: attendance
        .filter((a) => a.coachCheck === "present")
        .map((a) => a.memberSvenskalagId)
        .sort(),
    })
    .where(
      and(
        eq(workouts.id, follow.workoutId),
        eq(workouts.presenceVersion, follow.version),
        eq(workouts.presencePushedVersion, follow.version),
      ),
    );
}

async function syncPlayerAttendance(
  workoutId: string,
  attendance: SvenskalagAttendance[],
  now: Date,
  checks: CheckPolicy,
) {
  const db = getDb();
  const { players, workoutAttendance } = schema;
  // Someone the coaches marked present after the start stays, also before svenskalag.se knows.
  const removable = and(
    eq(workoutAttendance.workoutId, workoutId),
    checks.started ? sql`${workoutAttendance.coachCheck} is distinct from 'present'` : undefined,
  );
  if (attendance.length === 0) {
    await db.delete(workoutAttendance).where(removable);
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
        coachCheck: sql`case when ${checks.guard} then excluded.coach_check else ${workoutAttendance.coachCheck} end`,
        updatedAt: now,
      },
    });

  // Answers removed on svenskalag.se disappear here too.
  await db.delete(workoutAttendance).where(and(removable, notInArray(workoutAttendance.playerId, [...ids.values()])));
}

async function syncCoachAttendance(
  workoutId: string,
  attendance: SvenskalagAttendance[],
  now: Date,
  checks: CheckPolicy,
) {
  const db = getDb();
  const { coaches, workoutCoachAttendance } = schema;
  const removable = and(
    eq(workoutCoachAttendance.workoutId, workoutId),
    checks.started ? sql`${workoutCoachAttendance.coachCheck} is distinct from 'present'` : undefined,
  );
  if (attendance.length === 0) {
    await db.delete(workoutCoachAttendance).where(removable);
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
        coachCheck: sql`case when ${checks.guard} then excluded.coach_check else ${workoutCoachAttendance.coachCheck} end`,
        updatedAt: now,
      },
    });

  await db
    .delete(workoutCoachAttendance)
    .where(and(removable, notInArray(workoutCoachAttendance.coachId, [...ids.values()])));
}
