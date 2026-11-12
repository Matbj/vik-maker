"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { loadPresenceVersion, setCoachCheck, startLiveAttendance } from "@/lib/attendance/live";
import { ATTENDANCE_OPENS_BEFORE_MS, PUSH_DEBOUNCE_MS } from "@/lib/attendance/times";
import { coachRef, groupRef, playerRef, recordAudit, workoutRef } from "@/lib/audit";
import { currentCoach } from "@/lib/auth/sessions";
import { UserError } from "@/lib/errors";
import { proposeLevelGroups, proposeSpread, proposeTeams } from "@/lib/grouping/claude-groups";
import { loadGroupingPreferences } from "@/lib/grouping/preferences";
import { maxLeagueCount } from "@/lib/grouping/teams";
import {
  loadLevelGroups,
  loadLevelOrder,
  loadRecentTeams,
  loadWorkoutPlayers,
  withHistory,
  type WorkoutPlayer,
} from "@/lib/grouping/workout-players";
import { realtimeUrl } from "@/lib/realtime/live-queries";
import { presencePushEnabled, pushPresence } from "@/lib/svenskalag/presence";
import { refreshWorkoutAttendance } from "@/lib/svenskalag/sync";

export type GroupingState = { error?: string };

type NewGroup = { name: string; levelCodes: string[]; league: number | null; playerIds: string[] };

const levelGroupsForm = z.object({
  workoutId: z.uuid(),
  groupCount: z.coerce.number().int().min(1).max(12),
});

const teamsForm = z.object({
  workoutId: z.uuid(),
  teamCount: z.coerce.number().int().min(1).max(16),
  leagueCount: z.coerce.number().int().min(1).max(3).default(1),
  keepGroups: z.literal("on").optional(),
});

async function replaceGroups(
  workoutId: string,
  kind: "level" | "team",
  groups: NewGroup[],
  players: WorkoutPlayer[],
) {
  const db = getDb();
  const rows = groups.map((group, sortOrder) => ({ ...group, id: randomUUID(), sortOrder }));

  // One atomic batch, so a coach never ends up with the old groups half replaced.
  const [replaced] = await db.batch([
    db
      .delete(schema.workoutGroups)
      .where(and(eq(schema.workoutGroups.workoutId, workoutId), eq(schema.workoutGroups.kind, kind)))
      .returning({ id: schema.workoutGroups.id, name: schema.workoutGroups.name }),
    db.insert(schema.workoutGroups).values(
      rows.map(({ id, name, levelCodes, league, sortOrder }) => ({
        id,
        workoutId,
        kind,
        name,
        levelCodes,
        league,
        sortOrder,
      })),
    ),
    db
      .insert(schema.workoutGroupMembers)
      .values(rows.flatMap((row) => row.playerIds.map((playerId) => ({ groupId: row.id, playerId })))),
  ]);
  revalidatePath(`/traningar/${workoutId}`);

  const names = new Map(players.map((player) => [player.id, player.name]));
  await recordAudit(kind === "level" ? "level_groups.create" : "teams.create", async () => ({
    workout: await workoutRef(workoutId),
    replacedGroups: replaced,
    groups: rows.map(({ id, name, levelCodes, league, playerIds }) => ({
      id,
      name,
      levelCodes,
      league,
      players: playerIds.map((playerId) => ({ id: playerId, name: names.get(playerId) })),
    })),
  }));
}

async function loadWorkout(workoutId: string) {
  const [workout] = await getDb()
    .select()
    .from(schema.workouts)
    .where(eq(schema.workouts.id, workoutId));
  if (!workout) throw new UserError("Den här träningen finns inte längre.");
  return workout;
}

function errorMessage(error: unknown, fallback = "Något gick fel. Försök igen.") {
  console.error(error);
  return { error: error instanceof UserError ? error.message : fallback };
}

export async function createLevelGroups(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = levelGroupsForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Välj mellan 1 och 12 grupper." };
  const { workoutId, groupCount } = form.data;

  try {
    const workout = await loadWorkout(workoutId);
    const levelOrder = await loadLevelOrder();
    const { players } = await loadWorkoutPlayers(workoutId, levelOrder);
    if (players.length < groupCount) {
      return { error: `Det finns bara ${players.length} spelare till ${groupCount} ${groupCount === 1 ? "grupp" : "grupper"}.` };
    }

    const proposal = await proposeLevelGroups(
      await withHistory(players, workout.startsAt),
      levelOrder,
      groupCount,
      await loadGroupingPreferences(),
    );
    await replaceGroups(
      workoutId,
      "level",
      proposal.map((group) => ({ ...group, league: null })),
      players,
    );
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

export async function refreshAttendance(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const workoutId = z.uuid().safeParse(formData.get("workoutId"));
  if (!workoutId.success) return { error: "Den här träningen finns inte längre." };

  try {
    const workout = await loadWorkout(workoutId.data);
    await refreshWorkoutAttendance(workout.id, workout.svenskalagId);
    revalidatePath(`/traningar/${workout.id}`);
    await recordAudit("attendance.refresh", async () => ({ workout: await workoutRef(workout.id) }));
    return {};
  } catch (error) {
    return errorMessage(error, "Svaren kunde inte hämtas från svenskalag.se. Försök igen om en liten stund.");
  }
}

/**
 * Switches the workout to live for every coach: the attendance is filled in from the answers
 * and saved to svenskalag.se, and from then each coach checks off their players here.
 */
export async function startWorkout(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const workoutId = z.uuid().safeParse(formData.get("workoutId"));
  if (!workoutId.success) return { error: "Den här träningen finns inte längre." };

  try {
    const workout = await loadWorkout(workoutId.data);
    if (workout.liveStartedAt) return {};
    if (Date.now() < workout.startsAt.getTime() - ATTENDANCE_OPENS_BEFORE_MS) {
      throw new UserError("Närvaron kan fyllas i från 15 minuter innan träningen börjar.");
    }
    const coach = await currentCoach();
    if (!coach) throw new UserError("Du är inte längre inloggad. Ladda om sidan.");

    // The answers here can be hours old. If svenskalag.se is down the coaches still get to start.
    try {
      await refreshWorkoutAttendance(workout.id, workout.svenskalagId);
    } catch (error) {
      console.error("refreshing the attendance before the start failed:", error);
    }

    const start = await startLiveAttendance(workout.id, coach.id);
    if (start.started) {
      // A failed save is shown on the page, which then offers to try again.
      await pushPresence(workout.id, { verify: true });
      await recordAudit("workout.start", async () => ({
        workout: await workoutRef(workout.id),
        seededPlayers: start.seededPlayers,
        seededCoaches: start.seededCoaches,
      }));
    }
    revalidatePath(`/traningar/${workout.id}`);
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

const attendanceInput = z.object({
  workoutId: z.uuid(),
  kind: z.enum(["player", "coach"]),
  memberId: z.uuid(),
  present: z.boolean(),
});

/**
 * One tap on a player or coach at a started workout. Kept short, as a phone's actions run one
 * at a time: it only writes to our database, which the other coaches' pages then pick up. The
 * save to svenskalag.se follows after the response, once the taps have paused.
 */
export async function setAttendance(input: z.input<typeof attendanceInput>): Promise<GroupingState> {
  const parsed = attendanceInput.safeParse(input);
  if (!parsed.success) return { error: "Närvaron kunde inte sparas. Ladda om sidan och försök igen." };
  const { workoutId, kind, memberId, present } = parsed.data;

  try {
    const version = await setCoachCheck(workoutId, kind, memberId, present);
    if (version === null) throw new UserError("Starta träningen först.");
    // With live updates the page redraws from the change itself, so a second render is skipped.
    if (!realtimeUrl()) revalidatePath(`/traningar/${workoutId}`);

    after(async () => {
      await recordAudit("attendance.set", async () => ({
        workout: await workoutRef(workoutId),
        [kind]: kind === "player" ? await playerRef(memberId) : await coachRef(memberId),
        present,
      }));
      if (!presencePushEnabled()) return;
      await new Promise((resolve) => setTimeout(resolve, PUSH_DEBOUNCE_MS));
      // A later tap has bumped the version, and saves for this one too.
      if ((await loadPresenceVersion(workoutId)) === version) await pushPresence(workoutId);
    });
    return {};
  } catch (error) {
    return errorMessage(error, "Närvaron kunde inte sparas. Försök igen.");
  }
}

const pushInput = z.object({ workoutId: z.uuid(), manual: z.boolean() });

/**
 * Saves the attendance to svenskalag.se now. Open pages call it when a save has been waiting
 * too long, and a coach calls it with `manual` to try again after a failure.
 */
export async function pushPresenceNow(input: z.input<typeof pushInput>): Promise<GroupingState> {
  const parsed = pushInput.safeParse(input);
  if (!parsed.success) return { error: "Den här träningen finns inte längre." };
  const { workoutId, manual } = parsed.data;

  try {
    await pushPresence(workoutId, manual ? { verify: true, retry: true } : {});
    revalidatePath(`/traningar/${workoutId}`);
    if (manual) await recordAudit("presence.push", async () => ({ workout: await workoutRef(workoutId) }));
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

const groupKindForm = z.object({ workoutId: z.uuid(), kind: z.enum(["level", "team"]) });

export async function spreadNewPlayers(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = groupKindForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Den här träningen finns inte längre." };
  const { workoutId, kind } = form.data;

  try {
    const db = getDb();
    const workout = await loadWorkout(workoutId);
    const levelOrder = await loadLevelOrder();
    const { players } = await loadWorkoutPlayers(workoutId, levelOrder);
    const groups = await db
      .select()
      .from(schema.workoutGroups)
      .where(and(eq(schema.workoutGroups.workoutId, workoutId), eq(schema.workoutGroups.kind, kind)));
    if (groups.length === 0) return { error: "Skapa grupperna eller lagen först." };

    const members = await db
      .select({
        groupId: schema.workoutGroupMembers.groupId,
        playerId: schema.workoutGroupMembers.playerId,
        levelCode: schema.levels.code,
      })
      .from(schema.workoutGroupMembers)
      .innerJoin(schema.players, eq(schema.players.id, schema.workoutGroupMembers.playerId))
      .leftJoin(schema.levels, eq(schema.levels.id, schema.players.levelId))
      .where(
        inArray(
          schema.workoutGroupMembers.groupId,
          groups.map((group) => group.id),
        ),
      );

    const placedIds = new Set(members.map((member) => member.playerId));
    const newPlayers = players.filter((player) => !placedIds.has(player.id));
    if (newPlayers.length === 0) return {};

    const here = new Set(players.map((player) => player.id));
    const placements = await proposeSpread(
      await withHistory(newPlayers, workout.startsAt),
      groups.map((group) => ({
        id: group.id,
        levelCodes: group.levelCodes,
        league: group.league,
        members: members
          .filter((member) => member.groupId === group.id)
          .map((member) => ({
            id: member.playerId,
            levelCode: member.levelCode,
            absent: !here.has(member.playerId),
          })),
      })),
      levelOrder,
      await loadGroupingPreferences(),
    );

    await db
      .insert(schema.workoutGroupMembers)
      .values(placements.map(({ groupId, playerId }) => ({ groupId, playerId, addedLate: true })))
      .onConflictDoNothing();
    revalidatePath(`/traningar/${workoutId}`);
    await recordAudit(kind === "level" ? "level_groups.spread" : "teams.spread", async () => ({
      workout: await workoutRef(workoutId),
      placements: placements.map(({ groupId, playerId }) => ({
        player: { id: playerId, name: newPlayers.find((player) => player.id === playerId)?.name },
        group: { id: groupId, name: groups.find((group) => group.id === groupId)?.name },
      })),
    }));
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

export async function deleteGroups(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = groupKindForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Den här träningen finns inte längre." };
  const { workoutId, kind } = form.data;

  try {
    const deleted = await getDb()
      .delete(schema.workoutGroups)
      .where(and(eq(schema.workoutGroups.workoutId, workoutId), eq(schema.workoutGroups.kind, kind)))
      .returning({ id: schema.workoutGroups.id, name: schema.workoutGroups.name });
    revalidatePath(`/traningar/${workoutId}`);
    if (deleted.length > 0) {
      await recordAudit(kind === "level" ? "level_groups.delete" : "teams.delete", async () => ({
        workout: await workoutRef(workoutId),
        groups: deleted,
      }));
    }
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

const GROUPS_CHANGED = "Grupperna har ändrats. Ladda om sidan och försök igen.";

const movePlayerForm = z.object({
  workoutId: z.uuid(),
  playerId: z.uuid(),
  fromGroupId: z.uuid(),
  toGroupId: z.uuid(),
});

/** A coach's own decision, so it skips the level and keep-apart rules the AI has to follow. */
export async function movePlayer(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = movePlayerForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: GROUPS_CHANGED };
  const { workoutId, playerId, fromGroupId, toGroupId } = form.data;

  try {
    const db = getDb();
    const groups = await db
      .select({ kind: schema.workoutGroups.kind })
      .from(schema.workoutGroups)
      .where(
        and(
          eq(schema.workoutGroups.workoutId, workoutId),
          inArray(schema.workoutGroups.id, [fromGroupId, toGroupId]),
        ),
      );
    if (groups.length !== 2 || groups[0].kind !== groups[1].kind) return { error: GROUPS_CHANGED };

    const moved = await db
      .update(schema.workoutGroupMembers)
      .set({ groupId: toGroupId })
      .where(
        and(
          eq(schema.workoutGroupMembers.groupId, fromGroupId),
          eq(schema.workoutGroupMembers.playerId, playerId),
        ),
      )
      .returning({ playerId: schema.workoutGroupMembers.playerId });
    if (moved.length === 0) return { error: GROUPS_CHANGED };

    revalidatePath(`/traningar/${workoutId}`);
    await recordAudit("player.move", async () => ({
      workout: await workoutRef(workoutId),
      player: await playerRef(playerId),
      fromGroup: await groupRef(fromGroupId),
      toGroup: await groupRef(toGroupId),
    }));
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

const groupMemberForm = z.object({ workoutId: z.uuid(), playerId: z.uuid(), groupId: z.uuid() });

/** Places a player without a group or team where a coach chose, also past the AI's rules. */
export async function assignPlayer(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = groupMemberForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: GROUPS_CHANGED };
  const { workoutId, playerId, groupId } = form.data;

  try {
    const db = getDb();
    const [group] = await db
      .select({ kind: schema.workoutGroups.kind })
      .from(schema.workoutGroups)
      .where(and(eq(schema.workoutGroups.id, groupId), eq(schema.workoutGroups.workoutId, workoutId)));
    if (!group) return { error: GROUPS_CHANGED };

    const [placed] = await db
      .select({ playerId: schema.workoutGroupMembers.playerId })
      .from(schema.workoutGroupMembers)
      .innerJoin(schema.workoutGroups, eq(schema.workoutGroups.id, schema.workoutGroupMembers.groupId))
      .where(
        and(
          eq(schema.workoutGroups.workoutId, workoutId),
          eq(schema.workoutGroups.kind, group.kind),
          eq(schema.workoutGroupMembers.playerId, playerId),
        ),
      )
      .limit(1);
    if (placed) return { error: GROUPS_CHANGED };

    await db
      .insert(schema.workoutGroupMembers)
      .values({ groupId, playerId, addedLate: true })
      .onConflictDoNothing();
    revalidatePath(`/traningar/${workoutId}`);
    await recordAudit("player.assign", async () => ({
      workout: await workoutRef(workoutId),
      player: await playerRef(playerId),
      group: await groupRef(groupId),
    }));
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

export async function removePlayer(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = groupMemberForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: GROUPS_CHANGED };
  const { workoutId, playerId, groupId } = form.data;

  try {
    const removed = await getDb()
      .delete(schema.workoutGroupMembers)
      .where(
        and(
          eq(schema.workoutGroupMembers.groupId, groupId),
          eq(schema.workoutGroupMembers.playerId, playerId),
        ),
      )
      .returning({ playerId: schema.workoutGroupMembers.playerId });
    revalidatePath(`/traningar/${workoutId}`);
    if (removed.length > 0) {
      await recordAudit("player.remove", async () => ({
        workout: await workoutRef(workoutId),
        player: await playerRef(playerId),
        group: await groupRef(groupId),
      }));
    }
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

export async function createTeams(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = teamsForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Välj mellan 1 och 16 lag." };
  const { workoutId, teamCount, leagueCount, keepGroups } = form.data;

  try {
    const workout = await loadWorkout(workoutId);
    const levelOrder = await loadLevelOrder();
    const { players } = await loadWorkoutPlayers(workoutId, levelOrder);
    if (players.length < teamCount) {
      return { error: `Det finns bara ${players.length} spelare till ${teamCount} lag.` };
    }

    const leagues = Math.min(leagueCount, maxLeagueCount(teamCount));
    const teams = await proposeTeams(
      await withHistory(players, workout.startsAt),
      levelOrder,
      { teamCount, leagueCount: leagues },
      await loadRecentTeams(workoutId, workout.startsAt),
      // The groups are kept per league, so with one league there is nothing to keep.
      keepGroups && leagues > 1 ? await loadLevelGroups(workoutId) : [],
      await loadGroupingPreferences(),
    );
    await replaceGroups(
      workoutId,
      "team",
      teams.map((team, i) => ({ ...team, name: `Lag ${i + 1}`, levelCodes: [] })),
      players,
    );
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}
