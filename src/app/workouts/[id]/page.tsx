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
import { LevelGroupsForm, TeamsForm } from "./grouping-forms";

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
  const [{ players, registered }, coachAttendance, groupRows, memberRows] = await Promise.all([
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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{workout.title}</h1>
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
            `: ${coachAttendance.coaches.map((coach) => coach.name).join(", ")}`}
        </p>
      </header>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Leveled groups</h2>
        <LevelGroupsForm
          workoutId={id}
          playerCount={players.length}
          initialCount={levelGroups.length || 4}
          hasGroups={levelGroups.length > 0}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {levelGroups.map((group) => (
            <GroupCard key={group.id} title={group.name} count={group.members.length}>
              {group.members.map((member) => {
                const { direction } = levelMove(member.levelCode, group.levelCodes, levelOrder);
                return (
                  <li key={member.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="truncate">{member.name}</span>
                    {direction && (
                      <span className="shrink-0 text-xs font-semibold text-accent">
                        {direction === "up" ? "↑" : "↓"} from {member.levelCode}
                      </span>
                    )}
                  </li>
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
          initialCount={teams.length || 4}
          hasTeams={teams.length > 0}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <GroupCard
              key={team.id}
              title={team.league ? `League ${team.league} · ${team.name}` : team.name}
              count={team.members.length}
            >
              {team.members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate">{member.name}</span>
                  <span className="shrink-0 text-xs text-muted">{member.levelCode ?? "–"}</span>
                </li>
              ))}
            </GroupCard>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/10">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-muted">{count}</span>
      </div>
      <ul className="py-1">{children}</ul>
    </div>
  );
}
