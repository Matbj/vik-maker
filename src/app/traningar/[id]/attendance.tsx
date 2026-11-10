"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { PUSH_CATCH_UP_MS } from "@/lib/attendance/times";
import { pushPresenceNow, startWorkout } from "./actions";
import { AttendanceToggle, useAttendance } from "./attendance-state";
import { buttonClass, cancelButtonClass, Dialog, FormError } from "./grouping-forms";

/** setTimeout can't wait longer than about 24 days, and a workout that far off needs no timer. */
const LONGEST_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * Starts the workout for every coach. Appears when the attendance opens, 15 minutes before
 * the start, also on a page that was opened earlier and has been left open.
 */
export function StartWorkoutButton({
  workoutId,
  opensAt,
  open: openOnServer,
  label,
}: {
  workoutId: string;
  /** Milliseconds since the epoch. */
  opensAt: number;
  /** Whether it had opened when the page was made. */
  open: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState(startWorkout, {});
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (openOnServer) return;
    const wait = opensAt - Date.now();
    if (wait > LONGEST_TIMER_MS) return;
    const timer = setTimeout(() => setOpened(true), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [openOnServer, opensAt]);

  if (!openOnServer && !opened) return null;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workoutId" value={workoutId} />
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-3 text-base`}>
        {pending ? "Startar…" : label}
      </button>
      <FormError state={state} />
    </form>
  );
}

/**
 * Tells the coaches that the attendance is filled in here, and whether svenskalag.se has it.
 * Also asks for a save that has been waiting too long, as the function that should have made
 * it can have been stopped.
 */
export function LiveBanner({
  workoutId,
  title,
  savesToSvenskalag,
  version,
  pushedVersion,
  pushedAt,
  error,
  overwroteAt,
}: {
  workoutId: string;
  title: string;
  savesToSvenskalag: boolean;
  version: number;
  pushedVersion: number;
  /** When svenskalag.se last took a save, as text. */
  pushedAt: string | null;
  error: string | null;
  /** When a save last replaced a change made on svenskalag.se, as text. */
  overwroteAt: string | null;
}) {
  const [retrying, startRetry] = useTransition();
  const waiting = savesToSvenskalag && !error && version !== pushedVersion;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      // A page without a connection tries again at the next turn.
      pushPresenceNow({ workoutId, manual: false }).catch(() => {});
    }, PUSH_CATCH_UP_MS);
    return () => clearInterval(timer);
  }, [waiting, workoutId, version]);

  return (
    <div role="status" className="space-y-2 rounded-xl border-2 border-accent p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">
          {!savesToSvenskalag
            ? "Sparas inte i svenskalag.se"
            : error
              ? null
              : waiting
                ? "Sparar i svenskalag.se…"
                : pushedAt
                  ? `Sparat i svenskalag.se ${pushedAt}`
                  : null}
        </p>
      </div>
      <p className="text-sm text-muted">Bocka i de som är här. Alla ledare ser ändringarna direkt.</p>
      {error && (
        <div className="space-y-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <p>{error}</p>
          <button
            type="button"
            disabled={retrying}
            onClick={() =>
              startRetry(async () => {
                await pushPresenceNow({ workoutId, manual: true }).catch(() => {});
              })
            }
            className={cancelButtonClass}
          >
            {retrying ? "Sparar…" : "Försök igen"}
          </button>
        </div>
      )}
      {overwroteAt && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Närvaron ändrades i svenskalag.se medan den fylldes i här. Den ändringen ersattes {overwroteAt}.
        </p>
      )}
    </div>
  );
}

function AttendanceCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/10">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-muted">{count}</span>
      </div>
      {children}
    </div>
  );
}

/** The coaches at a started workout, each with their check. Folded, as the players come first. */
export function CoachAttendance({ coaches }: { coaches: { id: string; name: string }[] }) {
  const attendance = useAttendance();
  if (!attendance || coaches.length === 0) return null;
  const present = coaches.filter((coach) => attendance.isPresent("coach", coach.id));
  return (
    <details className="group rounded-xl border border-black/10 dark:border-white/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold">Ledare</span>
          <span className="block truncate text-xs text-muted">
            {present.length > 0 ? present.map((coach) => coach.name.split(" ")[0]).join(", ") : "Ingen ibockad"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted">
          {present.length} <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ul className="border-t border-black/10 py-1 dark:border-white/10">
        {coaches.map((coach) => (
          <li key={coach.id} className="flex items-center pr-3 text-sm">
            <AttendanceToggle kind="coach" id={coach.id} name={coach.name} />
            <span className={`truncate ${attendance.isPresent("coach", coach.id) ? "" : "text-muted"}`}>
              {coach.name}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export type LoosePlayer = {
  id: string;
  name: string;
  levelCode: string | null;
  /** What they answered, in Swedish, for the coach who is looking for them. */
  answer: string;
  /** Said yes, so they are likely to turn up. */
  expected: boolean;
};

/**
 * The players who have no row in a group or team to be checked off in. Those who are here are
 * listed with their check, and the rest can be added when they turn up after all.
 */
export function LoosePlayers({ players, hasGroups }: { players: LoosePlayer[]; hasGroups: boolean }) {
  const attendance = useAttendance();
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (!attendance) return null;

  const here = players.filter((player) => attendance.isPresent("player", player.id));
  const away = players
    .filter((player) => !attendance.isPresent("player", player.id))
    .sort((a, b) => Number(b.expected) - Number(a.expected));
  const expected = away.filter((player) => player.expected).length;

  return (
    <div className="space-y-3">
      {here.length > 0 && (
        <AttendanceCard title={hasGroups ? "Här utan grupp eller lag" : "Spelare"} count={here.length}>
          <ul className="py-1">
            {here.map((player) => (
              <li key={player.id} className="flex items-center justify-between gap-2 pr-3 text-sm">
                <span className="flex min-w-0 items-center">
                  <AttendanceToggle kind="player" id={player.id} name={player.name} />
                  <span className="truncate">{player.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{player.levelCode ?? "–"}</span>
              </li>
            ))}
          </ul>
        </AttendanceCard>
      )}
      {away.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => dialogRef.current?.showModal()}
            className={cancelButtonClass}
          >
            Lägg till spelare
          </button>
          {expected > 0 && (
            <p className="text-sm text-muted">
              {expected} som svarat Kommer är inte {expected === 1 ? "ibockad" : "ibockade"}.
            </p>
          )}
        </div>
      )}
      <Dialog dialogRef={dialogRef} title="Lägg till spelare" text="Välj de som är här. De blir närvarande direkt.">
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {away.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => attendance.mark("player", player.id, player.name, true)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-black/10 px-3 py-2.5 text-left text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="truncate font-medium">{player.name}</span>
                <span className="shrink-0 text-xs text-muted">{player.answer}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" onClick={() => dialogRef.current?.close()} className={buttonClass}>
            Klar
          </button>
        </div>
      </Dialog>
    </div>
  );
}
