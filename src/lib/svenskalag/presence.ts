import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { SvenskalagClient } from "./client";
import { isTrackedMember, type ParsedPresenceForm, type PresenceFormGroup } from "./parse";

/** Longer than a save takes, so a save that died doesn't block the next one for long. */
const LEASE = sql`now() + interval '45 seconds'`;
/** How many times one save follows edits made while it ran, before leaving the rest to the next. */
const MAX_ROUNDS = 5;
const SAVE_FAILED = "Närvaron kunde inte sparas i svenskalag.se.";

/**
 * Saving to svenskalag.se is off unless the env var says "on", so local development never
 * replaces the real attendance with the dev database's. Also the switch to stop saving.
 */
export function presencePushEnabled() {
  return env.SVENSKALAG_PRESENCE_PUSH === "on";
}

/** "busy" when another save is running, which then covers this one. "current" when nothing was waiting. */
export type PushOutcome = "disabled" | "busy" | "current" | "saved" | "failed";

/**
 * Saves a started workout's attendance to svenskalag.se, as the whole list from our database.
 * Only one save runs at a time per workout, and it keeps going until it has sent the newest
 * version. A failure is stored on the workout for the page to show, and never thrown.
 *
 * What was changed on svenskalag.se since our last save is first taken into our database, so
 * the list sent holds both sides' changes.
 *
 * `verify` reads the list back after saving. `retry` saves even when nothing looks to be waiting.
 */
export async function pushPresence(
  workoutId: string,
  { verify = false, retry = false }: { verify?: boolean; retry?: boolean } = {},
): Promise<PushOutcome> {
  if (!presencePushEnabled()) return "disabled";
  const db = getDb();
  const { workouts } = schema;

  const [leased] = await db
    .update(workouts)
    .set({ presencePushLeaseUntil: LEASE })
    .where(
      and(
        eq(workouts.id, workoutId),
        isNotNull(workouts.liveStartedAt),
        or(isNull(workouts.presencePushLeaseUntil), lt(workouts.presencePushLeaseUntil, sql`now()`)),
      ),
    )
    .returning({ svenskalagId: workouts.svenskalagId });
  if (!leased) return "busy";

  try {
    const client = new SvenskalagClient();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const ours = await loadPresence(workoutId);
      if (round === 0 && !retry && ours.version === ours.pushedVersion && !ours.failed) {
        await db.update(workouts).set({ presencePushLeaseUntil: null }).where(eq(workouts.id, workoutId));
        return "current";
      }
      if (ours.withoutSvenskalagId > 0) throw missingOnSvenskalag(ours.withoutSvenskalagId);

      const form = await client.fetchPresenceForm(leased.svenskalagId);
      const listed = trackedIds(form.groups);
      const theirs = new Set([...listed].filter((id) => ours.known.has(id)));
      // Without a last save there is nothing to tell their changes from ours by, so ours replaces theirs.
      const present = ours.pushedIds ? mergePresence(new Set(ours.pushedIds), theirs, ours.ids) : ours.ids;
      const overwrote = !ours.pushedIds && theirs.size > 0 && !sameIds(theirs, ours.ids);

      if (!sameIds(present, ours.ids)) {
        const taken = await takeTheirChanges(workoutId, ours.version, {
          present: [...present].filter((id) => !ours.ids.has(id)),
          absent: [...ours.ids].filter((id) => !present.has(id)),
        });
        if (!taken) {
          // Edited here meanwhile. The next round merges again from what is there now.
          await db.update(workouts).set({ presencePushLeaseUntil: LEASE }).where(eq(workouts.id, workoutId));
          continue;
        }
      }

      if (!sameIds(theirs, present)) {
        // Someone present there whom we don't know yet stays, as a sync hasn't brought them here.
        const sent = new Set([...present, ...[...listed].filter((id) => !ours.known.has(id))]);
        await client.savePresence(leased.svenskalagId, buildGroups(form, sent));
        if (verify) {
          const saved = trackedIds((await client.fetchPresenceForm(leased.svenskalagId)).groups);
          if (!sameIds(saved, sent)) throw new Error("svenskalag.se holds another attendance list than the one saved");
        }
      }

      const now = new Date();
      const [after] = await db
        .update(workouts)
        .set({
          presencePushedVersion: sql`greatest(${workouts.presencePushedVersion}, ${ours.version})`,
          presencePushedAt: now,
          presencePushedIds: [...present].sort(),
          presencePushError: null,
          ...(overwrote ? { presenceOverwroteAt: now } : {}),
          // Released in the same statement as the check, so an edit can't slip in between.
          presencePushLeaseUntil: sql`case when ${workouts.presenceVersion} = ${ours.version} then null else ${LEASE} end`,
        })
        .where(eq(workouts.id, workoutId))
        .returning({ version: workouts.presenceVersion });
      if (!after || after.version === ours.version) return "saved";
    }
    // Still being edited. The next edit or an open page saves the rest.
    await db.update(workouts).set({ presencePushLeaseUntil: null }).where(eq(workouts.id, workoutId));
    return "saved";
  } catch (error) {
    console.error(`saving the attendance of workout ${workoutId} to svenskalag.se failed:`, error);
    await db
      .update(workouts)
      .set({
        presencePushError: error instanceof UserError ? error.message : SAVE_FAILED,
        presencePushLeaseUntil: null,
      })
      .where(eq(workouts.id, workoutId));
    return "failed";
  }
}

/** The version and everyone present, read in one statement so the two belong together. */
async function loadPresence(workoutId: string) {
  const { rows } = await getDb().execute(sql`
    select
      w.presence_version as version,
      w.presence_pushed_version as pushed_version,
      w.presence_pushed_ids as pushed_ids,
      w.presence_push_error is not null as failed,
      (
        select coalesce(json_agg(p.svenskalag_id), '[]'::json)
        from workout_attendance a
        join players p on p.id = a.player_id
        where a.workout_id = w.id and a.coach_check = 'present'
      ) as players,
      (
        select coalesce(json_agg(c.svenskalag_id), '[]'::json)
        from workout_coach_attendance a
        join coaches c on c.id = a.coach_id
        where a.workout_id = w.id and a.coach_check = 'present'
      ) as coaches,
      (
        select coalesce(json_agg(svenskalag_id), '[]'::json)
        from (
          select svenskalag_id from players where svenskalag_id is not null
          union
          select svenskalag_id from coaches
        ) members
      ) as known
    from workouts w
    where w.id = ${workoutId}
  `);
  const row = rows[0] as
    | {
        version: number;
        pushed_version: number;
        pushed_ids: string[] | null;
        failed: boolean;
        players: (string | null)[];
        coaches: (string | null)[];
        known: string[];
      }
    | undefined;
  if (!row) throw new Error(`workout ${workoutId} is gone`);

  const present = [...row.players, ...row.coaches];
  const ids = new Set(present.filter((id): id is string => id !== null));
  return {
    version: row.version,
    pushedVersion: row.pushed_version,
    pushedIds: row.pushed_ids,
    failed: row.failed,
    ids,
    /** Every player and coach we have, by svenskalag.se id. */
    known: new Set(row.known),
    withoutSvenskalagId: present.length - ids.size,
  };
}

/**
 * Who is present when both sides have changed the list since `base`, the last one saved.
 * Someone we changed keeps our value and everyone else gets theirs. Present or absent are
 * the only values, so when both sides changed the same person they already agree.
 */
function mergePresence(base: Set<string>, theirs: Set<string>, ours: Set<string>) {
  const merged = new Set<string>();
  for (const id of new Set([...base, ...theirs, ...ours])) {
    const changedHere = ours.has(id) !== base.has(id);
    if (changedHere ? ours.has(id) : theirs.has(id)) merged.add(id);
  }
  return merged;
}

/**
 * Writes the checks that were changed on svenskalag.se to our database, by svenskalag.se id.
 * Only while the workout is at `version`, tested and locked in the same statement, so a tap
 * made meanwhile is never replaced. The version stays, as these are not ours to save back.
 */
async function takeTheirChanges(workoutId: string, version: number, changes: { present: string[]; absent: string[] }) {
  const present = sql`(select jsonb_array_elements_text(${JSON.stringify(changes.present)}::jsonb))`;
  const changed = sql`(select jsonb_array_elements_text(${JSON.stringify([...changes.present, ...changes.absent])}::jsonb))`;
  const { rows } = await getDb().execute(sql`
    with unedited as (
      select id from workouts
      where id = ${workoutId}::uuid and presence_version = ${version}
      for update
    ),
    taken_players as (
      insert into workout_attendance (workout_id, player_id, coach_check)
      select ${workoutId}::uuid, p.id,
        (case when p.svenskalag_id in ${present} then 'present' else 'absent' end)::coach_check
      from players p
      where p.svenskalag_id in ${changed} and exists (select 1 from unedited)
      on conflict (workout_id, player_id)
      do update set coach_check = excluded.coach_check, updated_at = now()
      returning 1
    ),
    taken_coaches as (
      insert into workout_coach_attendance (workout_id, coach_id, coach_check)
      select ${workoutId}::uuid, c.id,
        (case when c.svenskalag_id in ${present} then 'present' else 'absent' end)::coach_check
      from coaches c
      where c.svenskalag_id in ${changed} and exists (select 1 from unedited)
      on conflict (workout_id, coach_id)
      do update set coach_check = excluded.coach_check, updated_at = now()
      returning 1
    )
    select (select count(*) from unedited)::int as unedited
  `);
  return (rows[0] as { unedited: number }).unedited > 0;
}

/** The players and coaches saved as present. Other kinds of members are left as they are. */
function trackedIds(groups: PresenceFormGroup[]) {
  return new Set(
    groups
      .flatMap((group) => [...group.leaders, ...group.participants])
      .filter(isTrackedMember)
      .map((member) => String(member.id)),
  );
}

function sameIds(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * The groups to save: svenskalag.se's own, without those no longer present and with the new
 * ones added to the first group, as its "Lägg till" button does. Members are svenskalag.se's
 * own objects, untouched.
 */
function buildGroups(form: ParsedPresenceForm, present: Set<string>): PresenceFormGroup[] {
  const keep = (member: PresenceFormGroup["leaders"][number]) =>
    !isTrackedMember(member) || present.has(String(member.id));
  const groups: PresenceFormGroup[] =
    form.groups.length > 0
      ? form.groups.map((group) => ({
          ...group,
          leaders: group.leaders.filter(keep),
          participants: group.participants.filter(keep),
        }))
      : [{ id: 0, scheduleId: 0, name: "A", leaders: [], participants: [] }];

  const placed = trackedIds(groups);
  const [first] = groups;
  let missing = 0;
  for (const id of present) {
    if (placed.has(id)) continue;
    const member = form.known.get(id);
    if (!member) missing++;
    else (member.isLeader ? first.leaders : first.participants).push(member);
  }
  if (missing > 0) throw missingOnSvenskalag(missing);

  const bySortString = (a: { sortString?: string | null }, b: { sortString?: string | null }) =>
    (a.sortString ?? "").localeCompare(b.sortString ?? "", "sv", { numeric: true });
  first.leaders.sort(bySortString);
  first.participants.sort(bySortString);
  return groups;
}

function missingOnSvenskalag(count: number) {
  return new UserError(
    `${count} av de närvarande finns inte i lagets lista på svenskalag.se, så närvaron kunde inte sparas där.`,
  );
}
