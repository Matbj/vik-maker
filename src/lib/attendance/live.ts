import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Who starts as present: whoever said yes, or nobody. */
export type StartPresence = "attending" | "nobody";

/**
 * Starts a workout, once: from then the coaches fill in the attendance here. Whoever said
 * yes starts as present and everyone else as absent, or everyone as absent with `nobody`,
 * unless an attendance check is already registered, which is then kept. One statement, so
 * two coaches pressing at once start it once, and nobody sees a started workout that isn't
 * filled in yet.
 */
export async function startLiveAttendance(workoutId: string, coachId: string, presence: StartPresence) {
  const nobody = presence === "nobody";
  const { rows } = await getDb().execute(sql`
    with claimed as (
      update workouts
      set live_started_at = now(), live_started_by = ${coachId}::uuid,
        presence_version = presence_version + 1, updated_at = now()
      where id = ${workoutId}::uuid and live_started_at is null
      returning id
    ),
    unregistered as (
      select 1
      where not exists (
        select 1 from workout_attendance where workout_id = ${workoutId}::uuid and coach_check is not null
      ) and not exists (
        select 1 from workout_coach_attendance where workout_id = ${workoutId}::uuid and coach_check is not null
      )
    ),
    seeded_players as (
      update workout_attendance
      set coach_check = (case when not ${nobody}::boolean and player_response = 'attending' then 'present' else 'absent' end)::coach_check,
        updated_at = now()
      where workout_id = ${workoutId}::uuid
        and exists (select 1 from claimed) and exists (select 1 from unregistered)
      returning 1
    ),
    seeded_coaches as (
      update workout_coach_attendance
      set coach_check = (case when not ${nobody}::boolean and response = 'attending' then 'present' else 'absent' end)::coach_check,
        updated_at = now()
      where workout_id = ${workoutId}::uuid
        and exists (select 1 from claimed) and exists (select 1 from unregistered)
      returning 1
    )
    select
      (select count(*) from claimed)::int as claimed,
      (select count(*) from seeded_players)::int as players,
      (select count(*) from seeded_coaches)::int as coaches
  `);
  const row = rows[0] as { claimed: number; players: number; coaches: number };
  return { started: row.claimed > 0, seededPlayers: row.players, seededCoaches: row.coaches };
}

/**
 * Records whether a player or coach is at a started workout, also for someone who was never
 * asked. Returns the workout's new presence version, or null when it isn't started.
 */
export async function setCoachCheck(
  workoutId: string,
  kind: "player" | "coach",
  memberId: string,
  present: boolean,
) {
  const check = present ? "present" : "absent";
  const bumped = sql`
    update workouts set presence_version = presence_version + 1, updated_at = now()
    where id = ${workoutId}::uuid and live_started_at is not null
    returning presence_version
  `;
  const { rows } = await getDb().execute(
    kind === "player"
      ? sql`
          with bumped as (${bumped}),
          saved as (
            insert into workout_attendance (workout_id, player_id, coach_check)
            select ${workoutId}::uuid, ${memberId}::uuid, ${check}::coach_check where exists (select 1 from bumped)
            on conflict (workout_id, player_id)
            do update set coach_check = excluded.coach_check, updated_at = now()
            returning 1
          )
          select presence_version as version from bumped
        `
      : sql`
          with bumped as (${bumped}),
          saved as (
            insert into workout_coach_attendance (workout_id, coach_id, coach_check)
            select ${workoutId}::uuid, ${memberId}::uuid, ${check}::coach_check where exists (select 1 from bumped)
            on conflict (workout_id, coach_id)
            do update set coach_check = excluded.coach_check, updated_at = now()
            returning 1
          )
          select presence_version as version from bumped
        `,
  );
  return (rows[0] as { version: number } | undefined)?.version ?? null;
}

export async function loadPresenceVersion(workoutId: string) {
  const { workouts } = schema;
  const [workout] = await getDb()
    .select({ version: workouts.presenceVersion })
    .from(workouts)
    .where(eq(workouts.id, workoutId));
  return workout?.version ?? null;
}
