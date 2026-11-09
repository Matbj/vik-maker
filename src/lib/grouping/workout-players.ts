import "server-only";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";

const HISTORY_WORKOUTS = 8;

export type WorkoutPlayer = { id: string; name: string; levelCode: string | null; levelRank: number };
export type PlayerWithHistory = WorkoutPlayer & {
  history: { attended: boolean; played: string[] | null }[];
};

export async function loadLevelOrder() {
  const levels = await getDb().select().from(schema.levels).orderBy(asc(schema.levels.sortOrder));
  return levels.map((level) => level.code);
}

/** Who's there: the coaches' check once it's registered, until then whoever said yes. */
export async function loadWorkoutPlayers(workoutId: string, levelOrder: string[]) {
  const { players, levels, workoutAttendance } = schema;
  const rows = await getDb()
    .select({
      id: players.id,
      name: players.name,
      levelCode: levels.code,
      playerResponse: workoutAttendance.playerResponse,
      coachCheck: workoutAttendance.coachCheck,
    })
    .from(workoutAttendance)
    .innerJoin(players, eq(players.id, workoutAttendance.playerId))
    .leftJoin(levels, eq(levels.id, players.levelId))
    .where(eq(workoutAttendance.workoutId, workoutId))
    .orderBy(asc(players.name));

  const registered = rows.some((row) => row.coachCheck !== null);
  const attending = rows.filter((row) =>
    registered ? row.coachCheck === "present" : row.playerResponse === "attending",
  );

  const pool = new Set(attending.map((row) => row.id));
  return {
    registered,
    /** Why players who were asked aren't coming, for anyone still in a group or team. */
    absences: new Map(
      rows
        .filter((row) => !pool.has(row.id))
        .map((row) => {
          const reason = registered ? "Absent" : row.playerResponse === "declined" ? "Declined" : "No answer";
          return [row.id, reason] as const;
        }),
    ),
    players: attending.map(({ id, name, levelCode }): WorkoutPlayer => {
      const rank = levelCode ? levelOrder.indexOf(levelCode) : levelOrder.length;
      return { id, name, levelCode, levelRank: rank };
    }),
  };
}

/** Coaches at a workout: the attendance check once it's registered, until then whoever said yes. */
export async function loadWorkoutCoaches(workoutId: string) {
  const { coaches, workoutCoachAttendance } = schema;
  const rows = await getDb()
    .select({
      id: coaches.id,
      name: coaches.name,
      response: workoutCoachAttendance.response,
      coachCheck: workoutCoachAttendance.coachCheck,
    })
    .from(workoutCoachAttendance)
    .innerJoin(coaches, eq(coaches.id, workoutCoachAttendance.coachId))
    .where(eq(workoutCoachAttendance.workoutId, workoutId))
    .orderBy(asc(coaches.name));

  const registered = rows.some((row) => row.coachCheck !== null);
  return {
    registered,
    coaches: rows.filter((row) =>
      registered ? row.coachCheck === "present" : row.response === "attending",
    ),
  };
}

/** Adds each player's recent attendance and groups, newest first, from workouts already played. */
export async function withHistory(
  players: WorkoutPlayer[],
  workoutStartsAt: Date,
): Promise<PlayerWithHistory[]> {
  const { workouts, workoutAttendance, workoutGroups, workoutGroupMembers } = schema;
  const db = getDb();
  const before = new Date(Math.min(workoutStartsAt.getTime(), Date.now()));
  const recent = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(lt(workouts.startsAt, before))
    .orderBy(desc(workouts.startsAt))
    .limit(HISTORY_WORKOUTS);
  const workoutIds = recent.map((w) => w.id);
  if (workoutIds.length === 0) return players.map((p) => ({ ...p, history: [] }));

  const [attendance, groups] = await Promise.all([
    db.select().from(workoutAttendance).where(inArray(workoutAttendance.workoutId, workoutIds)),
    db
      .select({
        workoutId: workoutGroups.workoutId,
        playerId: workoutGroupMembers.playerId,
        levelCodes: workoutGroups.levelCodes,
      })
      .from(workoutGroupMembers)
      .innerJoin(workoutGroups, eq(workoutGroups.id, workoutGroupMembers.groupId))
      .where(and(inArray(workoutGroups.workoutId, workoutIds), eq(workoutGroups.kind, "level"))),
  ]);

  const key = (workoutId: string, playerId: string) => `${workoutId}:${playerId}`;
  const attended = new Set(
    attendance
      .filter((a) => a.coachCheck === "present" || (a.coachCheck === null && a.playerResponse === "attending"))
      .map((a) => key(a.workoutId, a.playerId)),
  );
  const played = new Map(groups.map((g) => [key(g.workoutId, g.playerId), g.levelCodes]));

  return players.map((player) => ({
    ...player,
    history: workoutIds.map((workoutId) => ({
      attended: attended.has(key(workoutId, player.id)),
      played: played.get(key(workoutId, player.id)) ?? null,
    })),
  }));
}
