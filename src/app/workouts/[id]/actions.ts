"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { proposeLevelGroups, proposeSpread, proposeTeams } from "@/lib/grouping/claude-groups";
import { loadGroupingPreferences } from "@/lib/grouping/preferences";
import {
  loadLevelOrder,
  loadRecentTeams,
  loadWorkoutPlayers,
  withHistory,
} from "@/lib/grouping/workout-players";
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
  twoLeagues: z.literal("on").optional(),
});

async function replaceGroups(workoutId: string, kind: "level" | "team", groups: NewGroup[]) {
  const db = getDb();
  const rows = groups.map((group, sortOrder) => ({ ...group, id: randomUUID(), sortOrder }));

  // One atomic batch, so a coach never ends up with the old groups half replaced.
  await db.batch([
    db
      .delete(schema.workoutGroups)
      .where(and(eq(schema.workoutGroups.workoutId, workoutId), eq(schema.workoutGroups.kind, kind))),
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
  revalidatePath(`/workouts/${workoutId}`);
}

async function loadWorkout(workoutId: string) {
  const [workout] = await getDb()
    .select()
    .from(schema.workouts)
    .where(eq(schema.workouts.id, workoutId));
  if (!workout) throw new Error("This workout no longer exists.");
  return workout;
}

function errorMessage(error: unknown) {
  console.error(error);
  return { error: error instanceof Error ? error.message : "Something went wrong." };
}

export async function createLevelGroups(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = levelGroupsForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "Choose between 1 and 12 groups." };
  const { workoutId, groupCount } = form.data;

  try {
    const workout = await loadWorkout(workoutId);
    const levelOrder = await loadLevelOrder();
    const { players } = await loadWorkoutPlayers(workoutId, levelOrder);
    if (players.length < groupCount) {
      return { error: `There are only ${players.length} players for ${groupCount} groups.` };
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
  if (!workoutId.success) return { error: "This workout no longer exists." };

  try {
    const workout = await loadWorkout(workoutId.data);
    await refreshWorkoutAttendance(workout.id, workout.svenskalagId);
    revalidatePath(`/workouts/${workout.id}`);
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}

const spreadForm = z.object({ workoutId: z.uuid(), kind: z.enum(["level", "team"]) });

export async function spreadNewPlayers(
  _previous: GroupingState,
  formData: FormData,
): Promise<GroupingState> {
  const form = spreadForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return { error: "This workout no longer exists." };
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
    if (groups.length === 0) return { error: "Create the groups or teams first." };

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
    revalidatePath(`/workouts/${workoutId}`);
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
  if (!form.success) return { error: "Choose between 1 and 16 teams." };
  const { workoutId, teamCount, twoLeagues } = form.data;

  try {
    const workout = await loadWorkout(workoutId);
    const levelOrder = await loadLevelOrder();
    const { players } = await loadWorkoutPlayers(workoutId, levelOrder);
    if (players.length < teamCount) {
      return { error: `There are only ${players.length} players for ${teamCount} teams.` };
    }

    const teams = await proposeTeams(
      await withHistory(players, workout.startsAt),
      levelOrder,
      { teamCount, twoLeagues: Boolean(twoLeagues) && teamCount >= 4 },
      await loadRecentTeams(workoutId, workout.startsAt),
      await loadGroupingPreferences(),
    );
    await replaceGroups(
      workoutId,
      "team",
      teams.map((team, i) => ({ ...team, name: `Team ${i + 1}`, levelCodes: [] })),
    );
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}
