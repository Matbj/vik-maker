"use client";

import { useActionState, useState } from "react";
import {
  createLevelGroups,
  createTeams,
  refreshAttendance,
  spreadNewPlayers,
  type GroupingState,
} from "./actions";

const inputClass =
  "w-16 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-center dark:border-white/10";
const buttonClass =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50";

function FormError({ state }: { state: GroupingState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {state.error}
    </p>
  );
}

/**
 * The number of groups and the players per group, linked through the number of players.
 * The count is what gets used: a size only picks the closest count, and then shows what
 * that count really gives. Typing is kept as drafts so a half-typed number isn't overwritten.
 */
function useLinkedCounts(playerCount: number, initialCount: number, maxCount: number) {
  const limit = Math.max(1, Math.min(maxCount, playerCount));
  const clamp = (value: number) => Math.min(Math.max(1, value), limit);
  const [count, setCount] = useState(clamp(initialCount));
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  return {
    count,
    countInput: {
      value: countDraft ?? String(count),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setCountDraft(event.target.value);
        const value = Number(event.target.value);
        if (value > 0) setCount(clamp(Math.round(value)));
      },
      onBlur: () => setCountDraft(null),
    },
    sizeInput: {
      value: sizeDraft ?? String(Math.round(playerCount / count)),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setSizeDraft(event.target.value);
        const value = Number(event.target.value);
        if (value > 0) setCount(clamp(Math.round(playerCount / value)));
      },
      onBlur: () => setSizeDraft(null),
    },
    smallest: Math.floor(playerCount / count),
    largest: Math.ceil(playerCount / count),
  };
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 ${spinning ? "animate-spin" : ""}`}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** The current groups or teams, blurred from when new ones are requested until they arrive. */
function ReplaceableCards({
  replacing,
  label,
  children,
}: {
  replacing: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        aria-busy={replacing}
        inert={replacing}
        className={`grid gap-3 transition-[filter] sm:grid-cols-2 ${replacing ? "select-none blur-sm" : ""}`}
      >
        {children}
      </div>
      {replacing && (
        <div className="absolute inset-0 flex justify-center pt-6">
          <p
            role="status"
            className="sticky top-20 flex h-fit items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-lg"
          >
            <RefreshIcon spinning />
            {label}
          </p>
        </div>
      )}
    </div>
  );
}

export function RefreshAttendanceButton({ workoutId }: { workoutId: string }) {
  const [state, action, pending] = useActionState(refreshAttendance, {});
  return (
    <form action={action} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="workoutId" value={workoutId} />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-white/10"
      >
        <RefreshIcon spinning={pending} />
        {pending ? "Uppdaterar…" : "Uppdatera närvaro"}
      </button>
      <FormError state={state} />
    </form>
  );
}

export function SpreadButton({
  workoutId,
  kind,
  label,
}: {
  workoutId: string;
  kind: "level" | "team";
  label: string;
}) {
  const [state, action, pending] = useActionState(spreadNewPlayers, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="workoutId" value={workoutId} />
      <input type="hidden" name="kind" value={kind} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Tänker…" : label}
      </button>
      <FormError state={state} />
    </form>
  );
}

export function LevelGroupsForm({
  workoutId,
  playerCount,
  initialCount,
  hasGroups,
  children,
}: {
  workoutId: string;
  playerCount: number;
  initialCount: number;
  hasGroups: boolean;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(createLevelGroups, {});
  const { count, countInput, sizeInput, smallest, largest } = useLinkedCounts(playerCount, initialCount, 12);
  return (
    <>
      <form action={action} className="space-y-2">
        <input type="hidden" name="workoutId" value={workoutId} />
        <input type="hidden" name="groupCount" value={count} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Grupper
            <input type="number" min={1} className={inputClass} {...countInput} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Spelare per grupp
            <input type="number" min={1} className={inputClass} {...sizeInput} />
          </label>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Tänker…" : hasGroups ? "Skapa nya grupper" : "Skapa grupper"}
          </button>
        </div>
        <p className="text-sm text-muted">
          {pending
            ? "Det tar några sekunder."
            : `${count} ${count === 1 ? "grupp" : "grupper"} med cirka ${smallest === largest ? smallest : `${smallest}–${largest}`} spelare`}
        </p>
        <FormError state={state} />
      </form>
      <ReplaceableCards replacing={pending && hasGroups} label="Skapar nya grupper…">
        {children}
      </ReplaceableCards>
    </>
  );
}

export function TeamsForm({
  workoutId,
  playerCount,
  initialCount,
  hasTeams,
  hasLevelGroups,
  children,
}: {
  workoutId: string;
  playerCount: number;
  initialCount: number;
  hasTeams: boolean;
  hasLevelGroups: boolean;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(createTeams, {});
  const { count, countInput, sizeInput, smallest, largest } = useLinkedCounts(playerCount, initialCount, 16);
  return (
    <>
      <form action={action} className="space-y-2">
        <input type="hidden" name="workoutId" value={workoutId} />
        <input type="hidden" name="teamCount" value={count} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Lag
            <input type="number" min={1} className={inputClass} {...countInput} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Spelare per lag
            <input type="number" min={1} className={inputClass} {...sizeInput} />
          </label>
          {count >= 4 && (
            <label className="flex items-center gap-2 text-sm">
              <input name="twoLeagues" type="checkbox" />
              Två serier
            </label>
          )}
          {hasLevelGroups && (
            <label className="flex items-center gap-2 text-sm">
              <input name="keepGroups" type="checkbox" />
              Behåll nivågrupperna så långt det går
            </label>
          )}
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Tänker…" : hasTeams ? "Skapa nya lag" : "Skapa lag"}
          </button>
        </div>
        <p className="text-sm text-muted">
          {count} lag med {smallest === largest ? smallest : `${smallest}–${largest}`} spelare
        </p>
        <FormError state={state} />
      </form>
      <ReplaceableCards replacing={pending && hasTeams} label="Skapar nya lag…">
        {children}
      </ReplaceableCards>
    </>
  );
}
