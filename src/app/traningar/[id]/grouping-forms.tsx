"use client";

import { useActionState, useId, useRef, useState } from "react";
import {
  createLevelGroups,
  createTeams,
  deleteGroups,
  movePlayer,
  refreshAttendance,
  removePlayer,
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

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M17 3l4 4-4 4" />
      <path d="M21 7H7" />
      <path d="M7 21l-4-4 4-4" />
      <path d="M3 17h14" />
    </svg>
  );
}

/**
 * Holds back a form's submit, also by the Enter key, until the dialog's own submit button is
 * pressed. Render the dialog after the form's main button, so that one stays the default.
 */
function useConfirmSubmit(needed: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return {
    dialogRef,
    confirmRef,
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
      if (!needed) return;
      if ((event.nativeEvent as SubmitEvent).submitter === confirmRef.current) {
        dialogRef.current?.close();
      } else {
        event.preventDefault();
        dialogRef.current?.showModal();
      }
    },
  };
}

function Dialog({
  dialogRef,
  title,
  text,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl bg-background text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 id={titleId} className="font-semibold">
            {title}
          </h3>
          <p className="text-sm text-muted">{text}</p>
        </div>
        {children}
      </div>
    </dialog>
  );
}

const cancelButtonClass = "rounded-lg border border-black/10 px-4 py-2 text-sm font-medium dark:border-white/10";

function ConfirmDialog({
  dialogRef,
  confirmRef,
  title,
  text,
  confirmLabel,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  confirmRef: React.RefObject<HTMLButtonElement | null>;
  title: string;
  text: string;
  confirmLabel: string;
}) {
  return (
    <Dialog dialogRef={dialogRef} title={title} text={text}>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => dialogRef.current?.close()} className={cancelButtonClass}>
          Avbryt
        </button>
        <button ref={confirmRef} type="submit" className={buttonClass}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
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

export function DeleteGroupsButton({ workoutId, kind }: { workoutId: string; kind: "level" | "team" }) {
  const [state, action, pending] = useActionState(deleteGroups, {});
  const { dialogRef, confirmRef, onSubmit } = useConfirmSubmit(true);
  const label = kind === "level" ? "Ta bort grupperna" : "Ta bort lagen";
  return (
    <form action={action} onSubmit={onSubmit} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="workoutId" value={workoutId} />
      <input type="hidden" name="kind" value={kind} />
      <button
        type="submit"
        disabled={pending}
        aria-label={label}
        className="-mr-2.5 flex size-11 items-center justify-center rounded-full text-red-600 transition-colors enabled:hover:bg-red-500/15 disabled:opacity-50 dark:text-red-400"
      >
        <TrashIcon />
      </button>
      <ConfirmDialog
        dialogRef={dialogRef}
        confirmRef={confirmRef}
        title={`${label}?`}
        text={kind === "level" ? "Alla nivågrupper för träningen tas bort." : "Alla lag för träningen tas bort."}
        confirmLabel={label}
      />
      <FormError state={state} />
    </form>
  );
}

export type MoveDestination = { id: string; title: string; subtitle?: string; count: string };

/** One player in a group or team. Tapping the row reveals the buttons to move or remove them. */
export function PlayerRow({
  workoutId,
  groupId,
  playerId,
  name,
  kind,
  absent,
  destinations,
  children,
}: {
  workoutId: string;
  groupId: string;
  playerId: string;
  name: string;
  kind: "level" | "team";
  absent: boolean;
  destinations: MoveDestination[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [moveState, moveAction, moving] = useActionState(movePlayer, {});
  const [removeState, removeAction, removing] = useActionState(removePlayer, {});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const others = destinations.filter((destination) => destination.id !== groupId);
  const iconButtonClass =
    "flex size-11 items-center justify-center rounded-full transition-colors disabled:opacity-50";

  return (
    <li className={absent ? "bg-red-500/15" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        {children}
      </button>
      {open && (
        <div className="px-3 pb-1">
          <div className="flex justify-end gap-1">
            {others.length > 0 && (
              <button
                type="button"
                disabled={moving || removing}
                aria-label={`Flytta ${name}`}
                onClick={() => dialogRef.current?.showModal()}
                className={`${iconButtonClass} text-accent enabled:hover:bg-accent/15`}
              >
                <MoveIcon />
              </button>
            )}
            <form action={removeAction}>
              <input type="hidden" name="workoutId" value={workoutId} />
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="playerId" value={playerId} />
              <button
                type="submit"
                disabled={moving || removing}
                aria-label={`Ta bort ${name} från ${kind === "level" ? "gruppen" : "laget"}`}
                className={`${iconButtonClass} text-red-600 enabled:hover:bg-red-500/15 dark:text-red-400`}
              >
                <TrashIcon />
              </button>
            </form>
          </div>
          <FormError state={removeState} />
          <Dialog
            dialogRef={dialogRef}
            title={`Flytta ${name}`}
            text={kind === "level" ? "Välj gruppen spelaren ska flyttas till." : "Välj laget spelaren ska flyttas till."}
          >
            <form action={moveAction} className="space-y-2">
              <input type="hidden" name="workoutId" value={workoutId} />
              <input type="hidden" name="fromGroupId" value={groupId} />
              <input type="hidden" name="playerId" value={playerId} />
              {others.map((destination) => (
                <button
                  key={destination.id}
                  type="submit"
                  name="toGroupId"
                  value={destination.id}
                  disabled={moving}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-black/10 px-3 py-2.5 text-left text-sm transition-colors enabled:hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:enabled:hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{destination.title}</span>
                    {destination.subtitle && (
                      <span className="block text-xs text-muted">{destination.subtitle}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{destination.count}</span>
                </button>
              ))}
              <FormError state={moveState} />
            </form>
            <div className="flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className={cancelButtonClass}>
                Avbryt
              </button>
            </div>
          </Dialog>
        </div>
      )}
    </li>
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
  const { dialogRef, confirmRef, onSubmit } = useConfirmSubmit(hasGroups);
  return (
    <>
      <form
        action={action}
        onSubmit={onSubmit}
        className="space-y-2"
      >
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
          <ConfirmDialog
            dialogRef={dialogRef}
            confirmRef={confirmRef}
            title="Ersätta grupperna?"
            text="De nuvarande grupperna tas bort och nya skapas."
            confirmLabel="Ersätt grupperna"
          />
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
  const { dialogRef, confirmRef, onSubmit } = useConfirmSubmit(hasTeams);
  return (
    <>
      <form
        action={action}
        onSubmit={onSubmit}
        className="space-y-2"
      >
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
          <ConfirmDialog
            dialogRef={dialogRef}
            confirmRef={confirmRef}
            title="Ersätta lagen?"
            text="De nuvarande lagen tas bort och nya skapas."
            confirmLabel="Ersätt lagen"
          />
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
