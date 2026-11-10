import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { ATTENDANCE_OPENS_BEFORE_MS, workoutEnd } from "@/lib/attendance/times";
import { levelMove } from "@/lib/grouping/level-groups";
import {
  loadLevelOrder,
  loadWorkoutCoaches,
  loadWorkoutPlayers,
} from "@/lib/grouping/workout-players";
import { realtimeUrl, sealWorkoutLiveQueries } from "@/lib/realtime/workout-live";
import { presencePushEnabled } from "@/lib/svenskalag/presence";
import { AttendanceList, LiveBanner, StartWorkoutButton, type PersonRow } from "./attendance";
import { AttendanceProvider } from "./attendance-state";
import { LiveUpdates } from "./live-updates";
import { DeleteGroupsButton, LevelGroupsForm, PlayerRow, RefreshAttendanceButton, SpreadButton, TeamsForm, UnplacedPlayer } from "./grouping-forms";

const DEFAULT_PLAYERS_PER_GROUP = 8;
const DEFAULT_PLAYERS_PER_TEAM = 7;

// Claude can take a while to compute leveled groups.
export const maxDuration = 180;


const timeFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short" });

/** The time, with the day in front when it wasn't today. */
function recently(date: Date, now: Date) {
  const time = timeFormat.format(date);
  return dayFormat.format(date) === dayFormat.format(now) ? time : `${dayFormat.format(date)} ${time}`;
}

const whenFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WorkoutPage({ params }: PageProps<"/traningar/[id]">) {
  return (
    <section className="space-y-6">
      <Link href="/" className="inline-block text-sm text-muted">
        ← Träningar
      </Link>
      <Suspense fallback={<p className="text-sm text-muted">Laddar träningen…</p>}>
        <Workout params={params} />
      </Suspense>
    </section>
  );
}

async function Workout({ params }: { params: PageProps<"/traningar/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const [workout] = await db.select().from(schema.workouts).where(eq(schema.workouts.id, id));
  if (!workout) notFound();

  const started = workout.liveStartedAt !== null;
  const now = new Date();
  const levelOrder = await loadLevelOrder();
  const [
    { players, registered, absences, everyone },
    coachAttendance,
    groupRows,
    memberRows,
    liveQueries,
    squad,
    coachSquad,
  ] = await Promise.all([
    loadWorkoutPlayers(id, levelOrder),
    loadWorkoutCoaches(id),
    db
      .select()
      .from(schema.workoutGroups)
      .where(eq(schema.workoutGroups.workoutId, id))
      .orderBy(asc(schema.workoutGroups.sortOrder)),
    db
      .select({
        groupId: schema.workoutGroupMembers.groupId,
        id: schema.players.id,
        name: schema.players.name,
        levelCode: schema.levels.code,
        addedLate: schema.workoutGroupMembers.addedLate,
      })
      .from(schema.workoutGroupMembers)
      .innerJoin(schema.workoutGroups, eq(schema.workoutGroups.id, schema.workoutGroupMembers.groupId))
      .innerJoin(schema.players, eq(schema.players.id, schema.workoutGroupMembers.playerId))
      .leftJoin(schema.levels, eq(schema.levels.id, schema.players.levelId))
      .where(eq(schema.workoutGroups.workoutId, id))
      .orderBy(asc(schema.players.name)),
    sealWorkoutLiveQueries(id),
    // At a started workout anyone on the team can be checked off, also those who weren't asked.
    started
      ? db
          .select({ id: schema.players.id, name: schema.players.name, levelCode: schema.levels.code })
          .from(schema.players)
          .leftJoin(schema.levels, eq(schema.levels.id, schema.players.levelId))
          .where(eq(schema.players.active, true))
      : [],
    started
      ? db
          .select({ id: schema.coaches.id, name: schema.coaches.name })
          .from(schema.coaches)
          .where(isNotNull(schema.coaches.email))
      : [],
  ]);
  const liveUrl = realtimeUrl();

  const groups = groupRows.map((group) => ({
    ...group,
    members: memberRows.filter((member) => member.groupId === group.id),
  }));
  const levelGroups = groups.filter((g) => g.kind === "level");
  const teams = groups.filter((g) => g.kind === "team");

  const here = new Set(players.map((player) => player.id));
  const absenceOf = (playerId: string) =>
    here.has(playerId) ? null : (absences.get(playerId) ?? "Kommer inte");
  const countLabel = (members: { id: string }[]) => {
    const missing = members.filter((member) => !here.has(member.id)).length;
    return missing > 0 ? `${members.length - missing} + ${missing} frånvarande` : String(members.length);
  };

  const levelDestinations = levelGroups.map((group) => ({
    id: group.id,
    title: group.name,
    subtitle: levelLabel(group.levelCodes, group.name),
    count: countLabel(group.members),
  }));
  const teamDestinations = teams.map((team) => ({
    id: team.id,
    title: teamTitle(team),
    count: countLabel(team.members),
  }));

  const inGroup = new Set(levelGroups.flatMap((g) => g.members.map((m) => m.id)));
  const inTeam = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
  const newToGroups = levelGroups.length > 0 ? players.filter((p) => !inGroup.has(p.id)) : [];
  const newToTeams = teams.length > 0 ? players.filter((p) => !inTeam.has(p.id)) : [];
  const newPlayers = [...new Map([...newToGroups, ...newToTeams].map((p) => [p.id, p])).values()];
  const absentCount = new Set(
    groups.flatMap((g) => g.members.map((m) => m.id)).filter((playerId) => !here.has(playerId)),
  ).size;

  // At a started workout the lists also hold those on the team who weren't asked, to check them off.
  const askedPlayers = new Map(everyone.map((player) => [player.id, player]));
  const playerRows: PersonRow[] = [
    ...new Map([...squad, ...everyone].map((player) => [player.id, player])).values(),
  ].map(({ id: playerId, name, levelCode }) => {
    const row = askedPlayers.get(playerId);
    return {
      id: playerId,
      name,
      detail: levelCode,
      answer: row?.playerResponse ?? null,
      present: here.has(playerId),
      loose: !inGroup.has(playerId) && !inTeam.has(playerId),
    };
  });
  const askedCoaches = new Map(coachAttendance.everyone.map((coach) => [coach.id, coach]));
  const coachRows: PersonRow[] = [
    ...new Map([...coachSquad, ...coachAttendance.everyone].map((coach) => [coach.id, coach])).values(),
  ].map(({ id: coachId, name }) => {
    const row = askedCoaches.get(coachId);
    return {
      id: coachId,
      name,
      answer: row?.response ?? null,
      present: coachAttendance.registered ? row?.coachCheck === "present" : row?.response === "attending",
    };
  });
  const opensAt = workout.startsAt.getTime() - ATTENDANCE_OPENS_BEFORE_MS;
  const ended = now > workoutEnd(workout);
  const savesToSvenskalag = presencePushEnabled();

  const page = (
    <div className="space-y-8">
      {liveUrl && liveQueries && (
        <LiveUpdates key={id} workoutId={id} url={liveUrl} initialQueries={liveQueries} />
      )}
      <header>
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm text-muted">
            <span className="inline-block text-base font-medium text-foreground first-letter:uppercase">{whenFormat.format(workout.startsAt)}</span>
            {workout.location && ` · ${workout.location}`}
          </p>
          <RefreshAttendanceButton workoutId={id} fetchedAt={recently(workout.syncedAt, now)} />
        </div>
      </header>

      {started ? (
        <div className="space-y-3">
          <LiveBanner
            workoutId={id}
            title={ended ? "Närvaron fylls i här" : "Träningen pågår"}
            savesToSvenskalag={savesToSvenskalag}
            version={workout.presenceVersion}
            pushedVersion={workout.presencePushedVersion}
            pushedAt={workout.presencePushedAt && recently(workout.presencePushedAt, now)}
            error={workout.presencePushError}
          />
          <AttendanceList kind="coach" people={coachRows} checked />
          <AttendanceList kind="player" people={playerRows} checked hasGroups={groups.length > 0} />
        </div>
      ) : (
        <div className="space-y-3">
          <AttendanceList kind="coach" people={coachRows} checked={coachAttendance.registered} />
          <AttendanceList kind="player" people={playerRows} checked={registered} />
          <StartWorkoutButton
            workoutId={id}
            opensAt={opensAt}
            open={now.getTime() >= opensAt}
            label={ended ? "Fyll i närvaro" : "Starta träningen"}
          />
        </div>
      )}

      {!started && absentCount > 0 && (
        <p role="status" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {absentCount} spelare nedan kommer inte längre.
        </p>
      )}

      {newPlayers.length > 0 && (
        <div className="space-y-3 rounded-xl border-2 border-accent p-4">
          <h2 className="font-semibold">
            {newPlayers.length} spelare utan plats
          </h2>
          <ul className="flex flex-wrap gap-2">
            {newPlayers.map((player) => (
              <UnplacedPlayer
                key={player.id}
                workoutId={id}
                playerId={player.id}
                name={player.name}
                levelCode={player.levelCode}
                groups={inGroup.has(player.id) ? [] : levelDestinations}
                teams={inTeam.has(player.id) ? [] : teamDestinations}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {newToGroups.length > 0 && (
              <SpreadButton workoutId={id} kind="level" label="Fördela automatiskt på grupperna" />
            )}
            {newToTeams.length > 0 && (
              <SpreadButton workoutId={id} kind="team" label="Fördela automatiskt på lagen" />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Nivågrupper</h2>
          {levelGroups.length > 0 && <DeleteGroupsButton workoutId={id} kind="level" />}
        </div>
        <LevelGroupsForm
          workoutId={id}
          playerCount={players.length}
          initialCount={levelGroups.length || Math.round(players.length / DEFAULT_PLAYERS_PER_GROUP)}
          hasGroups={levelGroups.length > 0}
        >
          {levelGroups.map((group) => (
            <GroupCard
              key={group.id}
              title={group.name}
              subtitle={levelLabel(group.levelCodes, group.name)}
              count={countLabel(group.members)}
            >
              {group.members.map((member) => {
                const { direction } = levelMove(member.levelCode, group.levelCodes, levelOrder);
                return (
                  <PlayerRow
                    key={member.id}
                    workoutId={id}
                    groupId={group.id}
                    playerId={member.id}
                    kind="level"
                    destinations={levelDestinations}
                    name={member.name}
                    absence={absenceOf(member.id)}
                    addedLate={member.addedLate}
                  >
                    {direction ? (
                      <span className="shrink-0 text-xs font-semibold text-accent">
                        {direction === "up" ? "↑" : "↓"} från {member.levelCode}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">{member.levelCode ?? "–"}</span>
                    )}
                  </PlayerRow>
                );
              })}
            </GroupCard>
          ))}
        </LevelGroupsForm>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Lag</h2>
          {teams.length > 0 && <DeleteGroupsButton workoutId={id} kind="team" />}
        </div>
        <TeamsForm
          workoutId={id}
          playerCount={players.length}
          initialCount={teams.length || Math.round(players.length / DEFAULT_PLAYERS_PER_TEAM)}
          hasTeams={teams.length > 0}
          hasLevelGroups={levelGroups.length > 0}
        >
          {teams.map((team) => (
            <GroupCard
              key={team.id}
              title={teamTitle(team)}
              count={countLabel(team.members)}
            >
              {team.members.map((member) => (
                <PlayerRow
                  key={member.id}
                  workoutId={id}
                  groupId={team.id}
                  playerId={member.id}
                  kind="team"
                  destinations={teamDestinations}
                  name={member.name}
                  absence={absenceOf(member.id)}
                  addedLate={member.addedLate}
                >
                  <span className="shrink-0 text-xs text-muted">{member.levelCode ?? "–"}</span>
                </PlayerRow>
              ))}
            </GroupCard>
          ))}
        </TeamsForm>
      </div>
    </div>
  );

  if (!started) return page;
  return (
    <AttendanceProvider
      workoutId={id}
      presentPlayers={everyone.filter((player) => player.coachCheck === "present").map((player) => player.id)}
      presentCoaches={coachAttendance.everyone.filter((coach) => coach.coachCheck === "present").map((coach) => coach.id)}
      live={Boolean(liveUrl && liveQueries)}
    >
      {page}
    </AttendanceProvider>
  );
}

function teamTitle(team: { name: string; league: number | null }) {
  return team.league ? `Serie ${team.league} · ${team.name}` : team.name;
}

/** Older groups are named after their levels, so don't repeat those. */
function levelLabel(levelCodes: string[], name: string) {
  const label = levelCodes.join(" + ");
  return label === name ? undefined : label;
}

function GroupCard({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/10">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <span className="text-xs text-muted">{count}</span>
      </div>
      <ul className="py-1">{children}</ul>
    </div>
  );
}
