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
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

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

export function RefreshAttendanceButton({ workoutId }: { workoutId: string }) {
  const [state, action, pending] = useActionState(refreshAttendance, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="workoutId" value={workoutId} />
      <button
        type="submit"
        disabled={pending}
        className="whitespace-nowrap rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-white/10"
      >
        {pending ? "Refreshing…" : "Refresh attendance"}
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
        {pending ? "Thinking…" : label}
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
}: {
  workoutId: string;
  playerCount: number;
  initialCount: number;
  hasGroups: boolean;
}) {
  const [state, action, pending] = useActionState(createLevelGroups, {});
  const { count, countInput, sizeInput, smallest, largest } = useLinkedCounts(playerCount, initialCount, 12);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workoutId" value={workoutId} />
      <input type="hidden" name="groupCount" value={count} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Groups
          <input type="number" min={1} className={inputClass} {...countInput} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Players per group
          <input type="number" min={1} className={inputClass} {...sizeInput} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Thinking…" : hasGroups ? "Create new groups" : "Create groups"}
        </button>
      </div>
      <p className="text-sm text-muted">
        {pending
          ? "This takes a few seconds."
          : `${count} ${count === 1 ? "group" : "groups"} of about ${smallest === largest ? smallest : `${smallest}–${largest}`} players`}
      </p>
      <FormError state={state} />
    </form>
  );
}

export function TeamsForm({
  workoutId,
  playerCount,
  initialCount,
  hasTeams,
}: {
  workoutId: string;
  playerCount: number;
  initialCount: number;
  hasTeams: boolean;
}) {
  const [state, action, pending] = useActionState(createTeams, {});
  const { count, countInput, sizeInput, smallest, largest } = useLinkedCounts(playerCount, initialCount, 16);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workoutId" value={workoutId} />
      <input type="hidden" name="teamCount" value={count} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Teams
          <input type="number" min={1} className={inputClass} {...countInput} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Players per team
          <input type="number" min={1} className={inputClass} {...sizeInput} />
        </label>
        {count >= 4 && (
          <label className="flex items-center gap-2 text-sm">
            <input name="twoLeagues" type="checkbox" />
            Two leagues
          </label>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : hasTeams ? "Create new teams" : "Create teams"}
        </button>
      </div>
      <p className="text-sm text-muted">
        {count} {count === 1 ? "team" : "teams"} of {smallest === largest ? smallest : `${smallest}–${largest}`} players
      </p>
      <FormError state={state} />
    </form>
  );
}
