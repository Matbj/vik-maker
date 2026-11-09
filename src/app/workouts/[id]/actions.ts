"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { proposeLevelGroups } from "@/lib/grouping/claude-groups";
import { levelGroupNames } from "@/lib/grouping/level-groups";
import { buildTeams } from "@/lib/grouping/teams";
import { loadLevelOrder, loadWorkoutPlayers, withHistory } from "@/lib/grouping/workout-players";

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
    );
    const names = levelGroupNames(proposal);
    await replaceGroups(
      workoutId,
      "level",
      proposal.map((group, i) => ({ ...group, name: names[i], league: null })),
    );
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
    const { players } = await loadWorkoutPlayers(workoutId, await loadLevelOrder());
    if (players.length < teamCount) {
      return { error: `There are only ${players.length} players for ${teamCount} teams.` };
    }

    const teams = buildTeams(players, {
      teamCount,
      twoLeagues: Boolean(twoLeagues) && teamCount >= 4,
    });
    await replaceGroups(
      workoutId,
      "team",
      teams.map((team) => ({ ...team, levelCodes: [] })),
    );
    return {};
  } catch (error) {
    return errorMessage(error);
  }
}
