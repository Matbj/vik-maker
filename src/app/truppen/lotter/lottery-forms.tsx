"use client";

import { useActionState, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import {
  formatKronor,
  ticketsLeft,
  ticketStatus,
  ticketWord,
  type TicketCounts,
  type TicketStatus,
} from "@/lib/lottery";
import {
  createLottery,
  deleteLottery,
  handOutToAll,
  saveTickets,
  setLotteryClosed,
  updateLottery,
  type LotteryState,
} from "./actions";

const fieldClass =
  "w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 dark:border-white/10";
const buttonClass =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50";
const secondaryButtonClass =
  "rounded-lg border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/10";
const dangerButtonClass = "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

function FormError({ state }: { state: LotteryState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {state.error}
    </p>
  );
}

type LotteryValues = {
  id: string;
  name: string;
  ticketPrice: number;
  ticketsPerPlayer: number | null;
  dueOn: string | null;
};

/** Creates a lottery, or changes one when it is given. */
export function LotteryForm({ lottery }: { lottery?: LotteryValues }) {
  const [state, action, pending] = useActionState(lottery ? updateLottery : createLottery, {});
  return (
    <form action={action} className="space-y-3">
      {lottery && <input type="hidden" name="lotteryId" value={lottery.id} />}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Namn</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={lottery?.name}
          placeholder="Till exempel Bingolotter jul 2026"
          className={fieldClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Pris per lott, kr</span>
          <input
            name="ticketPrice"
            type="number"
            inputMode="numeric"
            required
            min={0}
            max={10000}
            defaultValue={lottery?.ticketPrice}
            className={fieldClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Lotter per spelare</span>
          <input
            name="ticketsPerPlayer"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            defaultValue={lottery?.ticketsPerPlayer ?? undefined}
            className={fieldClass}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Sista dag att redovisa</span>
        <input name="dueOn" type="date" defaultValue={lottery?.dueOn ?? undefined} className={fieldClass} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Sparar…" : lottery ? "Spara" : "Skapa"}
        </button>
        {state.saved && !pending && <span className="text-sm text-muted">Sparat</span>}
      </div>
      <FormError state={state} />
    </form>
  );
}

export function HandOutToAllForm({
  lotteryId,
  ticketsPerPlayer,
  playersWithout,
}: {
  lotteryId: string;
  ticketsPerPlayer: number | null;
  playersWithout: number;
}) {
  const [state, action, pending] = useActionState(handOutToAll, {});
  if (playersWithout === 0) return null;
  return (
    <form action={action} className="space-y-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <input type="hidden" name="lotteryId" value={lotteryId} />
      <p className="text-sm">
        {playersWithout} spelare har inte fått några lotter än.
      </p>
      <div className="flex items-center gap-2">
        <input
          name="tickets"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={1000}
          defaultValue={ticketsPerPlayer ?? undefined}
          aria-label="Lotter per spelare"
          className="w-20 rounded-lg border border-black/10 bg-transparent px-2 py-2 text-center dark:border-white/10"
        />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Delar ut…" : "Dela ut till alla dem"}
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export type LotteryPlayer = TicketCounts & { id: string; name: string };

type Filter = "all" | TicketStatus;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "Alla" },
  { value: "out", label: "Har kvar" },
  { value: "none", label: "Inga lotter" },
  { value: "done", label: "Klara" },
];

const statusClass: Record<TicketStatus, string> = {
  none: "bg-black/5 text-muted dark:bg-white/10",
  out: "bg-gold/25 text-foreground",
  done: "bg-green-600/15 text-green-700 dark:text-green-400",
};

function statusLabel(player: TicketCounts) {
  const status = ticketStatus(player);
  if (status === "none") return "Inga lotter";
  if (status === "done") return "Klar";
  return `${ticketsLeft(player)} kvar`;
}

/** Every player with their tickets. Tapping one opens a dialog to change the numbers. */
export function LotteryPlayers({
  lotteryId,
  ticketPrice,
  ticketsPerPlayer,
  closed,
  players,
}: {
  lotteryId: string;
  ticketPrice: number;
  ticketsPerPlayer: number | null;
  closed: boolean;
  players: LotteryPlayer[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = players.find((player) => player.id === selectedId);
  const shown = filter === "all" ? players : players.filter((player) => ticketStatus(player) === filter);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Visa">
        {filters.map((option) => {
          const active = filter === option.value;
          const count =
            option.value === "all"
              ? players.length
              : players.filter((player) => ticketStatus(player) === option.value).length;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={active}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
                active ? "bg-accent text-on-accent" : "bg-black/5 dark:bg-white/10"
              }`}
            >
              {option.label} <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">Ingen spelare här.</p>
      ) : (
        <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
          {shown.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                disabled={closed}
                onClick={() => {
                  setSelectedId(player.id);
                  dialogRef.current?.showModal();
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-default"
              >
                <span className="min-w-0">
                  <span className="block truncate">{player.name}</span>
                  {player.handedOut > 0 && (
                    <span className="block text-sm text-muted">
                      {player.handedOut} {ticketWord(player.handedOut)} · {player.paid} betalda
                      {player.returned > 0 && ` · ${player.returned} tillbaka`}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass[ticketStatus(player)]}`}
                >
                  {statusLabel(player)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog dialogRef={dialogRef} title={selected?.name ?? "Lotter"}>
        {selected && (
          <TicketsForm
            // A new key per player and per saved state, so the fields start from the latest numbers.
            key={`${selected.id}:${selected.handedOut}:${selected.paid}:${selected.returned}`}
            lotteryId={lotteryId}
            ticketPrice={ticketPrice}
            ticketsPerPlayer={ticketsPerPlayer}
            player={selected}
            onDone={() => dialogRef.current?.close()}
          />
        )}
      </Dialog>
    </div>
  );
}

function Stepper({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const stepClass =
    "flex size-10 items-center justify-center rounded-lg border border-black/10 text-lg font-semibold dark:border-white/10";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" aria-label={`${label}, en mindre`} onClick={() => onChange(Math.max(0, value - 1))} className={stepClass}>
          −
        </button>
        <input
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value) || 0)))}
          className="h-10 w-16 rounded-lg border border-black/10 bg-transparent text-center dark:border-white/10"
        />
        <button type="button" aria-label={`${label}, en till`} onClick={() => onChange(value + 1)} className={stepClass}>
          +
        </button>
      </span>
    </div>
  );
}

function TicketsForm({
  lotteryId,
  ticketPrice,
  ticketsPerPlayer,
  player,
  onDone,
}: {
  lotteryId: string;
  ticketPrice: number;
  ticketsPerPlayer: number | null;
  player: LotteryPlayer;
  onDone: () => void;
}) {
  const [handedOut, setHandedOut] = useState(player.handedOut);
  const [paid, setPaid] = useState(player.paid);
  const [returned, setReturned] = useState(player.returned);
  const [state, action, pending] = useActionState(async (previous: LotteryState, formData: FormData) => {
    const result = await saveTickets(previous, formData);
    if (result.saved) onDone();
    return result;
  }, {});
  const left = handedOut - paid - returned;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lotteryId" value={lotteryId} />
      <input type="hidden" name="playerId" value={player.id} />
      <input type="hidden" name="previousHandedOut" value={player.handedOut} />
      <input type="hidden" name="previousPaid" value={player.paid} />
      <input type="hidden" name="previousReturned" value={player.returned} />

      <div className="space-y-2">
        <Stepper name="handedOut" label="Utdelade" value={handedOut} onChange={setHandedOut} />
        <Stepper name="paid" label="Betalda" value={paid} onChange={setPaid} />
        <Stepper name="returned" label="Tillbaka" value={returned} onChange={setReturned} />
      </div>

      <div className="flex flex-wrap gap-2">
        {handedOut === 0 && ticketsPerPlayer && (
          <button type="button" onClick={() => setHandedOut(ticketsPerPlayer)} className={secondaryButtonClass}>
            Dela ut {ticketsPerPlayer}
          </button>
        )}
        {left > 0 && (
          <button type="button" onClick={() => setPaid(paid + left)} className={secondaryButtonClass}>
            Resten betalda
          </button>
        )}
        {left > 0 && paid > 0 && (
          <button type="button" onClick={() => setReturned(returned + left)} className={secondaryButtonClass}>
            Resten tillbaka
          </button>
        )}
      </div>

      <p className={`text-sm ${left < 0 ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
        {left < 0
          ? "Betalda och tillbaka är fler än de utdelade."
          : left > 0
            ? `${left} ${ticketWord(left)} kvar att redovisa, ${formatKronor(left * ticketPrice)} om de säljs.`
            : handedOut > 0
              ? `Klar. ${formatKronor(paid * ticketPrice)} betalt.`
              : "Inga lotter utdelade."}
      </p>

      <FormError state={state} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          Avbryt
        </button>
        <button type="submit" disabled={pending || left < 0} className={buttonClass}>
          {pending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </form>
  );
}

export function CloseLotteryButton({ lotteryId, closed }: { lotteryId: string; closed: boolean }) {
  return (
    <form action={setLotteryClosed}>
      <input type="hidden" name="lotteryId" value={lotteryId} />
      <input type="hidden" name="closed" value={closed ? "false" : "true"} />
      <button type="submit" className={secondaryButtonClass}>
        {closed ? "Öppna igen" : "Avsluta försäljningen"}
      </button>
    </form>
  );
}

export function DeleteLotteryButton({ lotteryId, name }: { lotteryId: string; name: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={secondaryButtonClass}>
        Ta bort
      </button>
      <Dialog
        dialogRef={dialogRef}
        title={`Ta bort ${name}?`}
        text="Alla spelares lotter i försäljningen försvinner. Det går inte att ångra."
      >
        <form action={deleteLottery} className="flex justify-end gap-2">
          <input type="hidden" name="lotteryId" value={lotteryId} />
          <button type="button" onClick={() => dialogRef.current?.close()} className={secondaryButtonClass}>
            Avbryt
          </button>
          <button type="submit" className={dangerButtonClass}>
            Ta bort
          </button>
        </form>
      </Dialog>
    </>
  );
}
