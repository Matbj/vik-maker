import "server-only";
import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentCoach } from "@/lib/auth/sessions";

const RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every action that can be logged, with the text the log page shows for it. */
export const AUDIT_ACTIONS = {
  login: "Loggade in",
  logout: "Loggade ut",
  "sync.run": "Synkade med svenskalag.se",
  "attendance.refresh": "Hämtade svaren från svenskalag.se",
  "workout.start": "Startade träningen",
  "attendance.set": "Ändrade närvaron",
  "presence.push": "Sparade närvaron i svenskalag.se på nytt",
  "level_groups.create": "Skapade grupper",
  "level_groups.delete": "Tog bort grupperna",
  "level_groups.spread": "Fördelade nya spelare i grupperna",
  "teams.create": "Skapade lag",
  "teams.delete": "Tog bort lagen",
  "teams.spread": "Fördelade nya spelare i lagen",
  "player.move": "Flyttade en spelare",
  "player.assign": "Placerade en spelare",
  "player.remove": "Tog bort en spelare ur en grupp eller ett lag",
  "separation.add": "Lade till ett par att hålla isär",
  "separation.remove": "Tog bort ett par att hålla isär",
  "grouping_notes.update": "Ändrade anteckningarna för gruppindelning",
  "lottery.create": "Skapade en lotteriförsäljning",
  "lottery.update": "Ändrade en lotteriförsäljning",
  "lottery.close": "Avslutade en lotteriförsäljning",
  "lottery.reopen": "Öppnade en lotteriförsäljning igen",
  "lottery.delete": "Tog bort en lotteriförsäljning",
  "lottery.hand_out": "Delade ut lotter",
  "lottery.undo_hand_out": "Ångrade en utdelning av lotter",
  "lottery.player_remove": "Tog bort en spelare ur en lotteriförsäljning",
  "lottery.player_add": "Lade till en spelare i en lotteriförsäljning",
  "lottery.tickets": "Ändrade en spelares lotter",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

type AuditDetails = Record<string, unknown>;
type Actor = { id: string; name: string };

async function write(actor: Actor, action: AuditAction, details: AuditDetails) {
  await getDb()
    .insert(schema.auditLog)
    .values({ coachId: actor.id, coachName: actor.name, action, details });
}

/**
 * Logs what the coach on this browser just did. The details are built in here,
 * as the change is already made and a failure must not look like the change failed.
 */
export async function recordAudit(
  action: AuditAction,
  details: () => AuditDetails | Promise<AuditDetails> = () => ({}),
) {
  try {
    const coach = await currentCoach();
    if (coach) await write(coach, action, await details());
  } catch (error) {
    console.error(`writing the audit entry ${action} failed:`, error);
  }
}

/** Logs a login. The new session's cookie isn't on this request, so the coach is passed in. */
export async function recordLogin(coachId: string) {
  try {
    const { coaches } = schema;
    const [coach] = await getDb()
      .select({ id: coaches.id, name: coaches.name })
      .from(coaches)
      .where(eq(coaches.id, coachId));
    if (coach) await write(coach, "login", {});
  } catch (error) {
    console.error("writing the audit entry login failed:", error);
  }
}

/** Removes entries past the retention period, as they hold children's names. Returns how many. */
export async function pruneAuditLog() {
  const { auditLog } = schema;
  const removed = await getDb()
    .delete(auditLog)
    .where(lt(auditLog.createdAt, new Date(Date.now() - RETENTION_DAYS * DAY_MS)))
    .returning({ id: auditLog.id });
  return removed.length;
}

export async function workoutRef(id: string) {
  const { workouts } = schema;
  const [workout] = await getDb()
    .select({ id: workouts.id, title: workouts.title, startsAt: workouts.startsAt })
    .from(workouts)
    .where(eq(workouts.id, id));
  return workout ?? { id };
}

export async function playerRef(id: string) {
  const { players } = schema;
  const [player] = await getDb()
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.id, id));
  return player ?? { id };
}

export async function coachRef(id: string) {
  const { coaches } = schema;
  const [coach] = await getDb()
    .select({ id: coaches.id, name: coaches.name })
    .from(coaches)
    .where(eq(coaches.id, id));
  return coach ?? { id };
}

export async function groupRef(id: string) {
  const { workoutGroups } = schema;
  const [group] = await getDb()
    .select({ id: workoutGroups.id, name: workoutGroups.name, kind: workoutGroups.kind })
    .from(workoutGroups)
    .where(eq(workoutGroups.id, id));
  return group ?? { id };
}
