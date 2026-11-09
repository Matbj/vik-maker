"use client";

import { useActionState } from "react";
import { addSeparation, saveGroupingNotes } from "./actions";

const fieldClass =
  "rounded-lg border border-black/10 bg-transparent px-2 py-2 text-sm dark:border-white/10";
const buttonClass =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50";

export function AddSeparationForm({ players }: { players: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addSeparation, {});
  const options = players.map((player) => (
    <option key={player.id} value={player.id}>
      {player.name}
    </option>
  ));
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select name="playerA" aria-label="Första spelaren" required defaultValue="" className={fieldClass}>
          <option value="" disabled>
            Välj en spelare
          </option>
          {options}
        </select>
        <select name="playerB" aria-label="Andra spelaren" required defaultValue="" className={fieldClass}>
          <option value="" disabled>
            Välj en spelare
          </option>
          {options}
        </select>
        <button type="submit" disabled={pending} className={buttonClass}>
          Håll isär
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function GroupingNotesForm({ initialNotes }: { initialNotes: string }) {
  const [state, action, pending] = useActionState(saveGroupingNotes, {});
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="notes"
        aria-label="Anteckningar för gruppindelning"
        rows={5}
        maxLength={2000}
        defaultValue={initialNotes}
        placeholder="Till exempel: håll grupperna ungefär lika stora, även om några spelare behöver flytta."
        className={`${fieldClass} w-full`}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Sparar…" : "Spara anteckningar"}
        </button>
        {state.saved && !pending && <span className="text-sm text-muted">Sparat</span>}
        {state.error && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
