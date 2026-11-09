"use client";

import { useActionState, useState } from "react";
import { createLevelGroups, createTeams, type GroupingState } from "./actions";

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

export function LevelGroupsForm({
  workoutId,
  initialCount,
  hasGroups,
}: {
  workoutId: string;
  initialCount: number;
  hasGroups: boolean;
}) {
  const [state, action, pending] = useActionState(createLevelGroups, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workoutId" value={workoutId} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Groups
          <input
            name="groupCount"
            type="number"
            min={1}
            max={12}
            defaultValue={initialCount}
            required
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Thinking…" : hasGroups ? "Create new groups" : "Create groups"}
        </button>
      </div>
      {pending && <p className="text-sm text-muted">This can take up to a minute.</p>}
      <FormError state={state} />
    </form>
  );
}

export function TeamsForm({
  workoutId,
  initialCount,
  initialSize,
  hasTeams,
}: {
  workoutId: string;
  initialCount: number;
  initialSize: number;
  hasTeams: boolean;
}) {
  const [state, action, pending] = useActionState(createTeams, {});
  const [teamCount, setTeamCount] = useState(initialCount);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workoutId" value={workoutId} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Teams
          <input
            name="teamCount"
            type="number"
            min={1}
            max={16}
            value={teamCount}
            onChange={(event) => setTeamCount(Number(event.target.value))}
            required
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Players per team
          <input
            name="teamSize"
            type="number"
            min={1}
            max={30}
            defaultValue={initialSize}
            required
            className={inputClass}
          />
        </label>
        {teamCount >= 4 && (
          <label className="flex items-center gap-2 text-sm">
            <input name="twoLeagues" type="checkbox" />
            Two leagues
          </label>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : hasTeams ? "Create new teams" : "Create teams"}
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}
