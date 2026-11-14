"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { PUSH_CATCH_UP_MS } from "@/lib/attendance/times";
import { pushPresenceNow, startWorkout, type GroupingState } from "./actions";
import type { StartPresence } from "@/lib/attendance/live";
import { AttendanceToggle, CheckMark, useAttendance } from "./attendance-state";
import { buttonClass, cancelButtonClass, FormError } from "./grouping-forms";

/** setTimeout can't wait longer than about 24 days, and a workout that far off needs no timer. */
const LONGEST_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * Starts the workout for every coach. Appears when the attendance opens, 15 minutes before
 * the start, also on a page that was opened earlier and has been left open. A dialog asks
 * whether those who said yes start as present or nobody does, unless a check is already
 * registered, which the start keeps either way.
 */
export function StartWorkoutButton({
  workoutId,
  opensAt,
  open: openOnServer,
  label,
  registered,
}: {
  workoutId: string;
  /** Milliseconds since the epoch. */
  opensAt: number;
  /** Whether it had opened when the page was made. */
  open: boolean;
  label: string;
  /** Whether an attendance check is already registered, such as one fetched from svenskalag.se. */
  registered: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(async (previous: GroupingState, formData: FormData) => {
    const result = await startWorkout(previous, formData);
    dialogRef.current?.close();
    return result;
  }, {});
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
      {registered ? (
        <button
          type="submit"
          name="presence"
          value="attending"
          disabled={pending}
          className={`${buttonClass} w-full py-3 text-base`}
        >
          {pending ? "Startar…" : label}
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={pending}
            onClick={() => dialogRef.current?.showModal()}
            className={`${buttonClass} w-full py-3 text-base`}
          >
            {pending ? "Startar…" : label}
          </button>
          <Dialog dialogRef={dialogRef} title={label} text="Vilka ska vara närvarande från start? Du kan ändra för var och en efteråt.">
            <div className="space-y-2">
              <StartChoice
                value="attending"
                title="De som svarat Kommer"
                subtitle="Spelare och ledare som svarat Kommer bockas i."
                disabled={pending}
              />
              <StartChoice
                value="nobody"
                title="Ingen"
                subtitle="Alla börjar utan bock, och ni bockar i de som är här."
                disabled={pending}
              />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className={cancelButtonClass}>
                Avbryt
              </button>
            </div>
          </Dialog>
        </>
      )}
      <FormError state={state} />
    </form>
  );
}

function StartChoice({
  value,
  title,
  subtitle,
  disabled,
}: {
  value: StartPresence;
  title: string;
  subtitle: string;
  disabled: boolean;
}) {
  return (
    <button
      type="submit"
      name="presence"
      value={value}
      disabled={disabled}
      className="block w-full rounded-lg border border-black/10 px-3 py-2.5 text-left text-sm transition-colors enabled:hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:enabled:hover:bg-white/5"
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-muted">{subtitle}</span>
    </button>
  );
}

/**
 * Tells the coaches that the attendance is filled in here, and whether svenskalag.se has it.
 * A tinted strip with the toggles' check, to stand apart from the cards of people below it. Also asks for
 * a save that has been waiting too long, as the function that should have made it can have
 * been stopped.
 */
export function LiveBanner({
  workoutId,
  ongoing,
  savesToSvenskalag,
  version,
  pushedVersion,
  pushedAt,
  error,
}: {
  workoutId: string;
  /** Whether the workout is on now, and not one that is filled in afterwards. */
  ongoing: boolean;
  savesToSvenskalag: boolean;
  version: number;
  pushedVersion: number;
  /** When svenskalag.se last took a save, as text. */
  pushedAt: string | null;
  error: string | null;
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
    <div role="status" className="space-y-2 rounded-lg bg-accent/10 px-3 py-2.5">
      <div className="flex gap-2.5">
        <span aria-hidden="true" className="relative flex size-5 shrink-0">
          {ongoing && (
            <span className="absolute inline-flex size-full rounded-full bg-accent opacity-50 motion-safe:animate-ping" />
          )}
          <span className="relative flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
            <CheckMark className="size-3" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold">{ongoing ? "Träningen pågår" : "Närvaron fylls i här"}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              {waiting && (
                <span
                  aria-hidden="true"
                  className="size-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent"
                />
              )}
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
          <p className="text-xs text-muted">Bocka i de som är här. Alla ledare ser det direkt.</p>
        </div>
      </div>
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
    </div>
  );
}

export type PersonRow = {
  id: string;
  name: string;
  /** Shown after the name, such as a player's level. */
  detail?: string | null;
  /** What they answered. Null for someone who wasn't asked to this workout. */
  answer: "attending" | "declined" | "unanswered" | null;
  /** Whether they count as there on the page's own data: checked off, or until then said yes. */
  present: boolean;
  /** A player in no group or team, who has no other row to be checked off in. */
  loose?: boolean;
};

/**
 * Just below the app's top bar in the layout, which is 3.5rem high with a 2px line under it.
 * An open list's heading sticks there, so it can be folded from anywhere in the list, and
 * follows the list out of view at its end.
 */
const UNDER_TOP_BAR = {
  stickyTop: "group-open:top-[calc(3.5rem+2px+env(safe-area-inset-top))]",
  scrollMargin: "scroll-mt-[calc(4rem+2px+env(safe-area-inset-top))]",
};

const ANSWERS = {
  attending: { label: "Kommer", order: 0, className: "" },
  unanswered: { label: "Inget svar", order: 1, className: "text-muted" },
  declined: { label: "Kan ej", order: 2, className: "text-red-700 dark:text-red-400" },
  none: { label: "Ej kallad", order: 3, className: "text-muted" },
} as const;

/**
 * The workout's coaches or players with what each of them answered. Folded, as the groups
 * come first. At a started workout everyone also has their check, so this is where someone
 * without a group, or who was never asked, is checked off. `checked` says whether who is
 * there comes from an attendance check, and not only from the answers.
 */
export function AttendanceList({
  kind,
  people,
  checked,
  hasGroups = false,
}: {
  kind: "coach" | "player";
  people: PersonRow[];
  checked: boolean;
  /** For players: whether the workout has groups or teams, which then hold most of the checks. */
  hasGroups?: boolean;
}) {
  const attendance = useAttendance();
  if (people.length === 0) return null;

  const isHere = (person: PersonRow) => (attendance ? attendance.isPresent(kind, person.id) : person.present);
  const answerOf = (person: PersonRow) => ANSWERS[person.answer ?? "none"];
  // Among the players, those who haven't answered come first, as they are the ones to chase.
  const orderOf = (person: PersonRow) => (kind === "player" && person.answer === "unanswered" ? -1 : answerOf(person).order);
  const rows = [...people].sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name, "sv"));
  const here = rows.filter(isHere);
  const count = (answer: PersonRow["answer"]) => people.filter((person) => person.answer === answer).length;
  const asked = people.filter((person) => person.answer !== null).length;
  // A late yes doesn't check anyone off, so say when someone who may have turned up has no row to be found in.
  const expected = attendance
    ? rows.filter((person) => person.loose && person.answer === "attending" && !isHere(person)).length
    : 0;

  return (
    <details
      onToggle={(event) => {
        // Folded from its stuck heading, the card is above the screen. Bring it back under the top bar.
        const card = event.currentTarget;
        if (!card.open && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start" });
      }}
      className={`group rounded-xl border border-black/10 dark:border-white/10 ${UNDER_TOP_BAR.scrollMargin}`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border-black/10 bg-background px-3 py-2 group-open:sticky group-open:z-[5] group-open:rounded-b-none group-open:border-b dark:border-white/10 [&::-webkit-details-marker]:hidden ${UNDER_TOP_BAR.stickyTop}`}
      >
        <span className="min-w-0">
          <span className="block font-semibold">{kind === "coach" ? "Ledare" : "Spelare"}</span>
          <span className="block text-sm">
            {kind === "coach"
              ? here.length > 0
                ? `${checked ? "Här" : "Kommer"}: ${here.map((coach) => coach.name.split(" ")[0]).join(", ")}`
                : checked
                  ? "Ingen ibockad"
                  : "Ingen har svarat Kommer"
              : `${checked ? "Här" : "Kommer"}: ${here.length} av ${asked}`}
          </span>
          <span className="block text-xs text-muted">
            {checked && `${count("attending")} kommer · `}
            {count("declined")} kan ej · {count("unanswered")} inget svar
          </span>
          {expected > 0 && (
            <span className="block text-xs font-medium text-accent">
              {expected} {hasGroups ? "utan grupp " : ""}har svarat Kommer men är inte {expected === 1 ? "ibockad" : "ibockade"}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted">
          {here.length} <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ul className="py-1">
        {rows.map((person) => (
          <li
            key={person.id}
            className={`flex items-center justify-between gap-2 pr-3 text-sm ${attendance ? "" : "py-2 pl-3"}`}
          >
            <span className="flex min-w-0 items-center">
              <AttendanceToggle kind={kind} id={person.id} name={person.name} />
              <span className={`truncate ${isHere(person) ? "" : "text-muted"}`}>{person.name}</span>
              {person.detail && <span className="ml-2 shrink-0 text-xs text-muted">{person.detail}</span>}
            </span>
            <span className={`shrink-0 text-xs ${answerOf(person).className}`}>{answerOf(person).label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
