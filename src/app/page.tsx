import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { Notice } from "@/components/notice";

const RECENT_DAYS = 14;

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WorkoutsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Upcoming workouts</h1>
      <Suspense fallback={<p className="text-sm text-muted">Loading workouts…</p>}>
        <WorkoutLists />
      </Suspense>
    </section>
  );
}

async function loadWorkouts(since: Date) {
  const { workouts, workoutAttendance } = schema;
  const countResponse = (response: string) =>
    sql<number>`count(*) filter (where ${workoutAttendance.playerResponse} = ${response})`.mapWith(Number);
  const countCheck = (check: string) =>
    sql<number>`count(*) filter (where ${workoutAttendance.coachCheck} = ${check})`.mapWith(Number);

  return getDb()
    .select({
      id: workouts.id,
      title: workouts.title,
      startsAt: workouts.startsAt,
      endsAt: workouts.endsAt,
      location: workouts.location,
      attending: countResponse("attending"),
      declined: countResponse("declined"),
      unanswered: countResponse("unanswered"),
      present: countCheck("present"),
      absent: countCheck("absent"),
    })
    .from(workouts)
    .leftJoin(workoutAttendance, eq(workoutAttendance.workoutId, workouts.id))
    .where(gte(workouts.startsAt, since))
    .groupBy(workouts.id)
    .orderBy(asc(workouts.startsAt));
}

type WorkoutRow = Awaited<ReturnType<typeof loadWorkouts>>[number];

async function WorkoutLists() {
  await connection();

  if (!env.DATABASE_URL) {
    return (
      <Notice title="Database not configured">
        Add <code>DATABASE_URL</code> to <code>.env.local</code>, then run{" "}
        <code>npm run db:migrate</code> and <code>npm run db:seed</code>.
      </Notice>
    );
  }

  const now = new Date();
  const rows = await loadWorkouts(new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000));
  const upcoming = rows.filter((w) => w.startsAt >= now);
  const recent = rows.filter((w) => w.startsAt < now).reverse();

  return (
    <>
      {upcoming.length > 0 ? (
        <WorkoutList workouts={upcoming} />
      ) : (
        <Notice title="No upcoming workouts">
          Workouts appear here after a sync from svenskalag.se.
        </Notice>
      )}
      {recent.length > 0 && (
        <>
          <h2 className="pt-2 text-lg font-semibold">Recent workouts</h2>
          <WorkoutList workouts={recent} />
        </>
      )}
    </>
  );
}

function WorkoutList({ workouts }: { workouts: WorkoutRow[] }) {
  return (
    <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
      {workouts.map((w) => {
        const registered = w.present + w.absent > 0;
        return (
          <li key={w.id}>
            <Link href={`/workouts/${w.id}`} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {dateFormat.format(w.startsAt)}, {timeFormat.format(w.startsAt)}
                {w.endsAt && `–${timeFormat.format(w.endsAt)}`}
              </p>
              <p className="truncate text-sm text-muted">
                {w.title}
                {w.location && ` · ${w.location}`}
              </p>
              {registered && (
                <p className="text-xs text-muted">
                  Responses: {w.attending} yes · {w.declined} no · {w.unanswered} no answer
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-3 text-center text-xs text-muted">
              {registered ? (
                <>
                  <Count label="Present" value={w.present} />
                  <Count label="Absent" value={w.absent} />
                </>
              ) : (
                <>
                  <Count label="Yes" value={w.attending} />
                  <Count label="No" value={w.declined} />
                  <Count label="?" value={w.unanswered} />
                </>
              )}
            </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-base font-semibold text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}
