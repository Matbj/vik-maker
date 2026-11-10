"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setAttendance } from "./actions";

type Kind = "player" | "coach";

/** A coach's own tap, shown at once and kept until the page's data says the same. */
type Tap = { present: boolean; pending: number; token: number };

type Attendance = {
  isPresent: (kind: Kind, id: string) => boolean;
  /** Where the coach's own tap on the person is: on its way to the server, or just saved there. */
  status: (kind: Kind, id: string) => "saving" | "saved" | null;
  mark: (kind: Kind, id: string, name: string, present: boolean) => void;
};

const AttendanceContext = createContext<Attendance | null>(null);

/** How many times a tap that didn't reach the server is sent, as the reception at a pitch can be poor. */
const ATTEMPTS = 3;
const RETRY_MS = 1_000;
/** How long the page's data gets to catch up with a saved tap before the page is fetched again. */
const CATCH_UP_MS = 3_000;
const ERROR_MS = 6_000;
/** How long a toggle shows that its tap was saved. Covers its animation. */
const SAVED_MS = 700;

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`;

/**
 * Who is present at a started workout, for every toggle on the page. The page's own data
 * arrives a moment after a tap, through the live updates, and would flip a toggle back and
 * forth in between. So a tap is held here until that data agrees with it.
 */
export function AttendanceProvider({
  workoutId,
  presentPlayers,
  presentCoaches,
  live,
  children,
}: {
  workoutId: string;
  presentPlayers: string[];
  presentCoaches: string[];
  /** Whether the page has live updates. Without them it is fetched again after each tap. */
  live: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [taps, setTaps] = useState<Record<string, Tap>>({});
  /** The taps that were just saved, by the token of the tap. */
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const nextToken = useRef(0);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const server = useMemo(
    () =>
      new Set([
        ...presentPlayers.map((id) => keyOf("player", id)),
        ...presentCoaches.map((id) => keyOf("coach", id)),
      ]),
    [presentPlayers, presentCoaches],
  );

  // New data from the page: a saved tap it agrees with has done its job. Left in place, it
  // would later overrule another coach's change to the same person.
  const [seenServer, setSeenServer] = useState(server);
  if (seenServer !== server) {
    setSeenServer(server);
    const held = Object.entries(taps).filter(([key, tap]) => tap.pending > 0 || tap.present !== server.has(key));
    if (held.length < Object.keys(taps).length) setTaps(Object.fromEntries(held));
  }

  // Latest values for the timers below, which outlive the render they were started in.
  const tapsRef = useRef(taps);
  const serverRef = useRef(server);
  useEffect(() => {
    tapsRef.current = taps;
    serverRef.current = server;
  });

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  const showError = useCallback((message: string) => {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
  }, []);

  /** Drops the tap, unless a later tap on the same person has replaced it. */
  const release = useCallback((key: string, token: number) => {
    setTaps((current) => {
      if (current[key]?.token !== token) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  }, []);

  const mark = useCallback(
    (kind: Kind, id: string, name: string, present: boolean) => {
      const key = keyOf(kind, id);
      const token = ++nextToken.current;
      setTaps((current) => ({ ...current, [key]: { present, token, pending: (current[key]?.pending ?? 0) + 1 } }));

      void (async () => {
        let failure: string | undefined;
        for (let attempt = 1; ; attempt++) {
          try {
            failure = (await setAttendance({ workoutId, kind, memberId: id, present })).error;
            break;
          } catch {
            if (attempt === ATTEMPTS) {
              failure = `Kunde inte spara närvaron för ${name}. Kontrollera anslutningen och försök igen.`;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, RETRY_MS * attempt));
          }
        }

        setTaps((current) => {
          const tap = current[key];
          return tap ? { ...current, [key]: { ...tap, pending: tap.pending - 1 } } : current;
        });
        if (failure) {
          showError(failure);
          release(key, token);
          return;
        }

        setSaved((current) => ({ ...current, [key]: token }));
        setTimeout(() => {
          setSaved((current) => {
            if (current[key] !== token) return current;
            const rest = { ...current };
            delete rest[key];
            return rest;
          });
        }, SAVED_MS);

        // The live update can be here before the action's own answer.
        if (serverRef.current.has(key) === present) return release(key, token);
        if (!live) router.refresh();
        setTimeout(() => {
          const tap = tapsRef.current[key];
          if (tap?.token !== token) return;
          // The live update never came, such as after a lost connection.
          if (serverRef.current.has(key) !== tap.present) router.refresh();
          setTimeout(() => release(key, token), CATCH_UP_MS);
        }, CATCH_UP_MS);
      })();
    },
    [workoutId, live, router, release, showError],
  );

  const attendance = useMemo<Attendance>(
    () => ({
      isPresent: (kind, id) => {
        const key = keyOf(kind, id);
        return taps[key]?.present ?? server.has(key);
      },
      status: (kind, id) => {
        const key = keyOf(kind, id);
        if ((taps[key]?.pending ?? 0) > 0) return "saving";
        return key in saved ? "saved" : null;
      },
      mark,
    }),
    [taps, saved, server, mark],
  );

  return (
    <AttendanceContext value={attendance}>
      {children}
      {error && (
        <p
          role="alert"
          className="fixed inset-x-4 bottom-20 z-10 mx-auto max-w-md rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          {error}
        </p>
      )}
    </AttendanceContext>
  );
}

/** Null until the workout is started, when there is nothing to toggle. */
export function useAttendance() {
  return useContext(AttendanceContext);
}

/**
 * The round check a coach taps to mark someone present or absent. It changes at once, and
 * shows that the tap is being sent with a turning ring, and that it was saved with a pop.
 */
export function AttendanceToggle({ kind, id, name }: { kind: Kind; id: string; name: string }) {
  const attendance = useAttendance();
  if (!attendance) return null;
  const present = attendance.isPresent(kind, id);
  const status = attendance.status(kind, id);
  const ringClass = "pointer-events-none absolute inset-0 m-auto rounded-full border-2";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={present}
      aria-busy={status === "saving"}
      aria-label={`${name} är här`}
      onClick={() => attendance.mark(kind, id, name, !present)}
      className="relative flex size-11 shrink-0 items-center justify-center"
    >
      {status === "saving" && (
        <span aria-hidden="true" className={`${ringClass} size-9 animate-spin border-accent/25 border-t-accent`} />
      )}
      {status === "saved" && (
        <span aria-hidden="true" className={`${ringClass} size-7 border-accent opacity-0 motion-safe:animate-saved-ring`} />
      )}
      <span
        className={`flex size-7 items-center justify-center rounded-full border-2 transition-colors ${
          present ? "border-accent bg-accent text-on-accent" : "border-current text-muted"
        } ${status === "saved" ? "motion-safe:animate-saved-pop" : ""}`}
      >
        {present && <CheckMark className="size-4" />}
      </span>
    </button>
  );
}

/** The check of the attendance toggle, also used where the page talks about attendance. */
export function CheckMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
