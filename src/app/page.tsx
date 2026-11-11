import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { presencePushEnabled } from "@/lib/svenskalag/presence";
import { Notice } from "@/components/notice";

const RECENT_DAYS = 14;

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayKeyFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WorkoutsPage() {
  return (
    <section className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted">Laddar träningar…</p>}>
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
      liveStartedAt: workouts.liveStartedAt,
      presenceVersion: workouts.presenceVersion,
      presencePushedVersion: workouts.presencePushedVersion,
      presencePushError: workouts.presencePushError,
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
      <Notice title="Databasen är inte konfigurerad">
        Lägg till <code>DATABASE_URL</code> i <code>.env.local</code> och kör sedan{" "}
        <code>npm run db:migrate</code> och <code>npm run db:seed</code>.
      </Notice>
    );
  }

  const now = new Date();
  const rows = await loadWorkouts(new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000));
  const todayKey = dayKeyFormat.format(now);
  const isToday = (w: WorkoutRow) => dayKeyFormat.format(w.startsAt) === todayKey;
  const today = rows.filter(isToday);
  const upcoming = rows.filter((w) => w.startsAt >= now && !isToday(w));
  const recent = rows.filter((w) => w.startsAt < now && !isToday(w)).reverse();

  return (
    <>
      {today.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">{today.length > 1 ? "Dagens träningar" : "Dagens träning"}</h2>
          <WorkoutList workouts={today} />
        </>
      )}
      <h2 className={`text-lg font-semibold ${today.length > 0 ? "pt-2" : ""}`}>Kommande träningar</h2>
      {upcoming.length > 0 ? (
        <WorkoutList workouts={upcoming} />
      ) : today.length > 0 ? (
        <p className="text-sm text-muted">Inga fler träningar inlagda just nu.</p>
      ) : (
        <Notice title="Inga kommande träningar">
          Träningarna visas här efter en synkning från svenskalag.se.
        </Notice>
      )}
      {recent.length > 0 && (
        <>
          <h2 className="pt-2 text-lg font-semibold">Senaste träningarna</h2>
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
            <Link href={`/traningar/${w.id}`} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium first-letter:uppercase">
                {dateFormat.format(w.startsAt)}, {timeFormat.format(w.startsAt)}
                {w.endsAt && `–${timeFormat.format(w.endsAt)}`}
              </p>
              <p className="truncate text-sm text-muted">
                {w.title}
                {w.location && ` · ${w.location}`}
              </p>
              {registered && (
                <p className="text-xs text-muted">
                  Svar: {w.attending} ja · {w.declined} nej · {w.unanswered} inget svar
                </p>
              )}
              <PresenceSyncStatus workout={w} />
            </div>
            <div className="flex shrink-0 gap-3 text-center text-xs text-muted">
              {registered ? (
                <>
                  <Count label="Närv." value={w.present} />
                  <Count label="Frånv." value={w.absent} />
                </>
              ) : (
                <>
                  <Count label="Ja" value={w.attending} />
                  <Count label="Nej" value={w.declined} />
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

const SYNC_TONES = {
  saved: "text-green-700 dark:text-green-400",
  waiting: "text-amber-700 dark:text-amber-400",
  failed: "text-red-700 dark:text-red-400",
  quiet: "text-muted",
};

/**
 * How a workout's närvaro stands against svenskalag.se, where the coaches otherwise look it up.
 * Small text like the row's other details, with a colored mark in front that tells the states
 * apart at a glance. Only a failed save colors the text too.
 */
function PresenceSyncStatus({ workout: w }: { workout: WorkoutRow }) {
  const status = presenceSyncStatus(w);
  if (!status) return null;
  return (
    <p className={`text-xs ${status.tone === "failed" ? SYNC_TONES.failed : "text-muted"}`}>
      <span aria-hidden="true" className={`mr-1 inline-block w-3 text-center font-bold ${SYNC_TONES[status.tone]}`}>
        {status.mark}
      </span>
      {status.text}
    </p>
  );
}

function presenceSyncStatus(w: WorkoutRow): { mark: string; tone: keyof typeof SYNC_TONES; text: string } | null {
  if (w.liveStartedAt) {
    if (!presencePushEnabled()) return { mark: "–", tone: "quiet", text: "Närvaron sparas inte i svenskalag.se" };
    if (w.presencePushError) return { mark: "!", tone: "failed", text: "Närvaron kunde inte sparas i svenskalag.se" };
    if (w.presencePushedVersion < w.presenceVersion) {
      return { mark: "↑", tone: "waiting", text: "Närvaron väntar på att sparas i svenskalag.se" };
    }
    return { mark: "✓", tone: "saved", text: "Närvaron sparad i svenskalag.se" };
  }
  if (w.present + w.absent > 0) return { mark: "↓", tone: "quiet", text: "Närvaron hämtad från svenskalag.se" };
  if (w.startsAt < new Date()) return { mark: "○", tone: "quiet", text: "Ingen närvaro tagen" };
  return null;
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-base font-semibold text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}
