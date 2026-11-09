import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { levelMove } from "@/lib/grouping/level-groups";
import {
  loadLevelOrder,
  loadWorkoutCoaches,
  loadWorkoutPlayers,
} from "@/lib/grouping/workout-players";
import { LevelGroupsForm, RefreshAttendanceButton, SpreadButton, TeamsForm } from "./grouping-forms";

const DEFAULT_PLAYERS_PER_GROUP = 8;
const DEFAULT_PLAYERS_PER_TEAM = 7;

// Claude can take a while to compute leveled groups.
export const maxDuration = 180;

const whenFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WorkoutPage({ params }: PageProps<"/workouts/[id]">) {
  return (
    <section className="space-y-6">
      <Link href="/" className="text-sm text-muted">
        ← Workouts
      </Link>
      <Suspense fallback={<p className="text-sm text-muted">Loading workout…</p>}>
        <Workout params={params} />
      </Suspense>
    </section>
  );
}

async function Workout({ params }: { params: PageProps<"/workouts/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const [workout] = await db.select().from(schema.workouts).where(eq(schema.workouts.id, id));
  if (!workout) notFound();

  const levelOrder = await loadLevelOrder();
  const [{ players, registered, absences }, coachAttendance, groupRows, memberRows] = await Promise.all([
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
  ]);

  const groups = groupRows.map((group) => ({
    ...group,
    members: memberRows.filter((member) => member.groupId === group.id),
  }));
  const levelGroups = groups.filter((g) => g.kind === "level");
  const teams = groups.filter((g) => g.kind === "team");

  const here = new Set(players.map((player) => player.id));
  const absenceOf = (playerId: string) =>
    here.has(playerId) ? null : (absences.get(playerId) ?? "Not attending");
  const countLabel = (members: { id: string }[]) => {
    const missing = members.filter((member) => !here.has(member.id)).length;
    return missing > 0 ? `${members.length - missing} + ${missing} absent` : String(members.length);
  };

  const inGroup = new Set(levelGroups.flatMap((g) => g.members.map((m) => m.id)));
  const inTeam = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
  const newToGroups = levelGroups.length > 0 ? players.filter((p) => !inGroup.has(p.id)) : [];
  const newToTeams = teams.length > 0 ? players.filter((p) => !inTeam.has(p.id)) : [];
  const newPlayers = [...new Map([...newToGroups, ...newToTeams].map((p) => [p.id, p])).values()];
  const absentCount = new Set(
    groups.flatMap((g) => g.members.map((m) => m.id)).filter((playerId) => !here.has(playerId)),
  ).size;

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl font-semibold">{workout.title}</h1>
          <RefreshAttendanceButton workoutId={id} />
        </div>
        <p className="text-sm text-muted">
          {whenFormat.format(workout.startsAt)}
          {workout.location && ` · ${workout.location}`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {players.length} {registered ? "players present" : "players attending"}
        </p>
        <p className="text-sm text-muted">
          {coachAttendance.coaches.length}{" "}
          {coachAttendance.registered ? "coaches present" : "coaches attending"}
          {coachAttendance.coaches.length > 0 &&
            `: ${coachAttendance.coaches.map((coach) => coach.name.split(" ")[0]).join(", ")}`}
        </p>
        <p className="mt-1 text-xs text-muted">Updated {whenFormat.format(workout.syncedAt)}</p>
      </header>

      {absentCount > 0 && (
        <p role="status" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">
          {absentCount} {absentCount === 1 ? "player" : "players"} in the groups or teams below{" "}
          {absentCount === 1 ? "is" : "are"} no longer coming.
        </p>
      )}

      {newPlayers.length > 0 && (
        <div className="space-y-3 rounded-xl border-2 border-accent p-4">
          <h2 className="font-semibold">
            {newPlayers.length} new {newPlayers.length === 1 ? "player" : "players"} without a place
          </h2>
          <ul className="flex flex-wrap gap-2">
            {newPlayers.map((player) => (
              <li key={player.id} className="rounded-full bg-accent/10 px-3 py-1 text-sm">
                {player.name} <span className="text-xs font-semibold text-accent">{player.levelCode ?? "–"}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {newToGroups.length > 0 && (
              <SpreadButton workoutId={id} kind="level" label={`Spread ${newToGroups.length} across groups`} />
            )}
            {newToTeams.length > 0 && (
              <SpreadButton workoutId={id} kind="team" label={`Spread ${newToTeams.length} across teams`} />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Leveled groups</h2>
        <LevelGroupsForm
          workoutId={id}
          playerCount={players.length}
          initialCount={levelGroups.length || Math.round(players.length / DEFAULT_PLAYERS_PER_GROUP)}
          hasGroups={levelGroups.length > 0}
        />
        <div className="grid gap-3 sm:grid-cols-2">
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
                  <MemberRow
                    key={member.id}
                    name={member.name}
                    absence={absenceOf(member.id)}
                    addedLate={member.addedLate}
                  >
                    {direction ? (
                      <span className="shrink-0 text-xs font-semibold text-accent">
                        {direction === "up" ? "↑" : "↓"} from {member.levelCode}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">{member.levelCode ?? "–"}</span>
                    )}
                  </MemberRow>
                );
              })}
            </GroupCard>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Teams</h2>
        <TeamsForm
          workoutId={id}
          playerCount={players.length}
          initialCount={teams.length || Math.round(players.length / DEFAULT_PLAYERS_PER_TEAM)}
          hasTeams={teams.length > 0}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <GroupCard
              key={team.id}
              title={team.league ? `League ${team.league} · ${team.name}` : team.name}
              count={countLabel(team.members)}
            >
              {team.members.map((member) => (
                <MemberRow
                  key={member.id}
                  name={member.name}
                  absence={absenceOf(member.id)}
                  addedLate={member.addedLate}
                >
                  <span className="shrink-0 text-xs text-muted">{member.levelCode ?? "–"}</span>
                </MemberRow>
              ))}
            </GroupCard>
          ))}
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  name,
  absence,
  addedLate,
  children,
}: {
  name: string;
  absence: string | null;
  addedLate: boolean;
  children: React.ReactNode;
}) {
  if (absence) {
    return (
      <li className="flex items-center justify-between gap-2 bg-red-500/15 px-3 py-1.5 text-sm">
        <span className="truncate font-medium text-red-700 line-through dark:text-red-400">{name}</span>
        <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
          {absence}
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{name}</span>
        {addedLate && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold uppercase text-white">
            New
          </span>
        )}
      </span>
      {children}
    </li>
  );
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
