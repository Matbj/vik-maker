"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import {
  amountOwed,
  formatHandedOutAt,
  formatKronor,
  noTickets,
  playerTotals,
  ticketsKept,
  ticketStatus,
  ticketValue,
  ticketWord,
  usualHandOut,
  type KindCounts,
  type LotteryKindInfo,
  type TicketCounts,
  type TicketStatus,
} from "@/lib/lottery";
import {
  createLottery,
  deleteLottery,
  handOutUsual,
  saveTickets,
  addToLottery,
  removeFromLottery,
  removePayment,
  setLotteryClosed,
  undoHandOut,
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

type LotteryValues = { id: string; name: string; dueOn: string | null; kinds: LotteryKindInfo[] };

/**
 * A row of the kinds editor: a saved kind's id, or a key for a new one, which keeps the row's
 * inputs while rows are removed. A saved kind's values are read from the props, so the inputs
 * show what was saved when React resets the form after the save.
 */
type KindRow = { key: string; kindId?: string };

let nextRowKey = 0;
const newRow = (): KindRow => ({ key: `new-${nextRowKey++}` });

/** Creates a lottery, or changes one when it is given. */
export function LotteryForm({ lottery }: { lottery?: LotteryValues }) {
  const [state, action, pending] = useActionState(lottery ? updateLottery : createLottery, {});
  const [rows, setRows] = useState<KindRow[]>(() =>
    lottery ? lottery.kinds.map((kind) => ({ key: kind.id, kindId: kind.id })) : [newRow()],
  );
  const kindsById = new Map(lottery?.kinds.map((kind) => [kind.id, kind]));
  return (
    <form action={action} className="space-y-4">
      {lottery && <input type="hidden" name="lotteryId" value={lottery.id} />}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Namn på försäljningen</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={lottery?.name}
          placeholder="Till exempel Julförsäljning 2026"
          className={fieldClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Sista dag att redovisa</span>
        <input name="dueOn" type="date" defaultValue={lottery?.dueOn ?? undefined} className={fieldClass} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sorters lotter</legend>
        {rows.map((row) => ({ ...row, kind: row.kindId ? kindsById.get(row.kindId) : undefined })).map((row, i) => (
          <div key={row.key} className="space-y-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
            <input type="hidden" name="kindId" value={row.kindId ?? ""} />
            <div className="flex items-center gap-2">
              <input
                name="kindName"
                required
                maxLength={60}
                defaultValue={row.kind?.name}
                placeholder={i === 0 ? "Till exempel Bingolotter" : "Till exempel Skraplotter"}
                aria-label="Sort"
                className={fieldClass}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
                  aria-label="Ta bort sorten"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xl text-muted"
                >
                  ×
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className="text-xs text-muted">Pris, kr</span>
                <input
                  name="kindPrice"
                  type="number"
                  inputMode="numeric"
                  required
                  min={0}
                  max={10000}
                  defaultValue={row.kind?.ticketPrice}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Lagets del, kr</span>
                <input
                  name="kindTeamShare"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10000}
                  defaultValue={row.kind?.teamShare ?? undefined}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Per spelare</span>
                <input
                  name="kindPerPlayer"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  defaultValue={row.kind?.ticketsPerPlayer ?? undefined}
                  className={fieldClass}
                />
              </label>
            </div>
          </div>
        ))}
        {rows.length < 10 && (
          <button type="button" onClick={() => setRows([...rows, newRow()])} className={secondaryButtonClass}>
            + Lägg till en sort
          </button>
        )}
      </fieldset>

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

function kindsSentence(kinds: LotteryKindInfo[]) {
  return usualHandOut(kinds)
    .map((kind) => `${kind.ticketsPerPlayer} ${kind.name}`)
    .join(" och ");
}

export type LotteryPayment = { id: string; amount: number; createdAt: Date };

/**
 * `handedOutAt` is when the player was first handed tickets in the sale, and `paid` the sum of
 * their payments.
 */
export type LotteryPlayer = {
  id: string;
  name: string;
  tickets: KindCounts;
  payments: LotteryPayment[];
  paid: number;
  handedOutAt: Date | null;
};

type Filter = "all" | TicketStatus;

// In the order a player goes through them.
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "Alla" },
  { value: "none", label: "Ej utdelade" },
  { value: "out", label: "Säljer" },
  { value: "done", label: "Redovisade" },
];

const statusClass: Record<TicketStatus, string> = {
  none: "bg-black/5 text-muted dark:bg-white/10",
  out: "bg-gold/25 text-foreground",
  done: "bg-green-600/15 text-green-700 dark:text-green-400",
};

function statusLabel(kinds: LotteryKindInfo[], player: LotteryPlayer) {
  const status = ticketStatus(kinds, player.tickets, player.paid);
  if (status === "none") return "Inga lotter";
  if (status === "done") return "Redovisad";
  return `${formatKronor(amountOwed(kinds, player.tickets, player.paid))} kvar`;
}

/** What a player has been handed, such as "Utdelat 12 november · 10 Bingolotter · 15 Skraplotter · 800 kr inlämnat". */
function ticketsSummary(kinds: LotteryKindInfo[], player: LotteryPlayer) {
  const { tickets } = player;
  const totals = playerTotals(kinds, tickets);
  const handed = kinds
    .filter((kind) => (tickets[kind.id]?.handedOut ?? 0) > 0)
    .map((kind) => (kinds.length === 1 ? `${tickets[kind.id].handedOut} ${ticketWord(tickets[kind.id].handedOut)}` : `${tickets[kind.id].handedOut} ${kind.name}`));
  const when = player.handedOutAt ? [`Utdelat ${formatHandedOutAt(player.handedOutAt)}`] : [];
  return [
    ...when,
    ...handed,
    ...(totals.returned > 0 ? [`${totals.returned} tillbaka`] : []),
    `${formatKronor(player.paid)} inlämnat`,
  ].join(" · ");
}

/** Every player with their tickets. Tapping one opens a dialog to change the numbers. */
export function LotteryPlayers({
  lotteryId,
  kinds,
  closed,
  players,
}: {
  lotteryId: string;
  kinds: LotteryKindInfo[];
  closed: boolean;
  players: LotteryPlayer[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const withStatus = players.map((player) => ({ ...player, status: ticketStatus(kinds, player.tickets, player.paid) }));
  const selected = withStatus.find((player) => player.id === selectedId);
  const canHandOut = !closed && usualHandOut(kinds).length > 0;
  const shown = filter === "all" ? withStatus : withStatus.filter((player) => player.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Visa">
        {filters.map((option) => {
          const active = filter === option.value;
          const count =
            option.value === "all" ? withStatus.length : withStatus.filter((player) => player.status === option.value).length;
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
          {shown.map((player) => {
            const quickHandOut = canHandOut && player.status === "none";
            return (
              <li key={player.id} className="flex items-center">
                <button
                  type="button"
                  disabled={closed}
                  onClick={() => {
                    setSelectedId(player.id);
                    setOpenCount(openCount + 1);
                    dialogRef.current?.showModal();
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-default"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{player.name}</span>
                    {player.status !== "none" && (
                      <span className="block text-sm text-muted">{ticketsSummary(kinds, player)}</span>
                    )}
                  </span>
                  {!quickHandOut && (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass[player.status]}`}>
                      {statusLabel(kinds, player)}
                    </span>
                  )}
                </button>
                {quickHandOut && <QuickHandOut lotteryId={lotteryId} playerId={player.id} />}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog dialogRef={dialogRef} title={selected?.name ?? "Lotter"}>
        {selected && (
          <TicketsForm
            // Starts from the latest numbers each time it opens, and keeps what the coach types after that.
            key={openCount}
            lotteryId={lotteryId}
            kinds={kinds}
            player={selected}
            onDone={() => dialogRef.current?.close()}
          />
        )}
      </Dialog>
    </div>
  );
}

/** Hands a player who has no tickets the usual number of every kind, in one tap. */
function QuickHandOut({ lotteryId, playerId }: { lotteryId: string; playerId: string }) {
  const [state, action, pending] = useActionState(handOutUsual, {});
  return (
    <form action={action} className="shrink-0 pr-3 text-right">
      <input type="hidden" name="lotteryId" value={lotteryId} />
      <input type="hidden" name="playerId" value={playerId} />
      <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1.5`}>
        {pending ? "Sparar…" : "Markera utdelat"}
      </button>
      {state.error && (
        <span role="alert" className="block max-w-40 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
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
      <span className="text-sm">{label}</span>
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

const paymentDateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  day: "numeric",
  month: "long",
});

/**
 * The player's payments, each removable after confirming, and the field for a new one. The field
 * belongs to the dialog's main form through `formId`, as forms can't be nested.
 */
function Payments({
  lotteryId,
  player,
  formId,
  amount,
  onAmountChange,
  owed,
}: {
  lotteryId: string;
  player: LotteryPlayer;
  formId: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  owed: number;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeState, removeAction, removing] = useActionState(async (previous: LotteryState, formData: FormData) => {
    const result = await removePayment(previous, formData);
    if (result.saved) setRemovingId(null);
    return result;
  }, {});

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Inlämnade pengar</h4>
      {player.payments.length > 0 && (
        <ul className="divide-y divide-black/10 text-sm dark:divide-white/10">
          {player.payments.map((payment) => (
            <li key={payment.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                {paymentDateFormat.format(payment.createdAt)}
                <span className="ml-2 font-semibold tabular-nums">{formatKronor(payment.amount)}</span>
              </span>
              {removingId === payment.id ? (
                <form action={removeAction} className="flex items-center gap-3">
                  <input type="hidden" name="lotteryId" value={lotteryId} />
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button type="button" onClick={() => setRemovingId(null)} className="text-muted underline">
                    Avbryt
                  </button>
                  <button type="submit" disabled={removing} className="font-semibold text-red-600 dark:text-red-400">
                    {removing ? "Tar bort…" : "Ta bort"}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setRemovingId(payment.id)}
                  aria-label="Ta bort inbetalningen"
                  className="px-2 text-lg text-muted"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError state={removeState} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          form={formId}
          name="amount"
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="Nytt belopp, kr"
          aria-label="Nytt belopp i kronor"
          className="w-36 rounded-lg border border-black/10 bg-transparent px-3 py-2 dark:border-white/10"
        />
        {owed > 0 && (
          <button type="button" onClick={() => onAmountChange(String(owed))} className={secondaryButtonClass}>
            Allt, {formatKronor(owed)}
          </button>
        )}
      </div>
    </div>
  );
}

function TicketsForm({
  lotteryId,
  kinds,
  player,
  onDone,
}: {
  lotteryId: string;
  kinds: LotteryKindInfo[];
  player: LotteryPlayer;
  onDone: () => void;
}) {
  // What the coach saw on opening. A change another coach saves meanwhile then fails the save, not overwrites.
  const [seenTickets] = useState<KindCounts>(() =>
    Object.fromEntries(kinds.map((kind) => [kind.id, player.tickets[kind.id] ?? noTickets])),
  );
  const [tickets, setTickets] = useState(seenTickets);
  const [amount, setAmount] = useState("");
  const formId = useId();
  const [state, action, pending] = useActionState(async (previous: LotteryState, formData: FormData) => {
    const result = await saveTickets(previous, formData);
    if (result.saved) onDone();
    return result;
  }, {});
  const [handOutState, handOutAction, handingOut] = useActionState(async (previous: LotteryState, formData: FormData) => {
    const result = await handOutUsual(previous, formData);
    if (result.saved) onDone();
    return result;
  }, {});
  const [confirming, setConfirming] = useState<"undo" | "remove" | null>(null);
  const [confirmState, confirmAction, confirmPending] = useActionState(async (previous: LotteryState, formData: FormData) => {
    const result = await (confirming === "remove" ? removeFromLottery : undoHandOut)(previous, formData);
    if (result.saved) onDone();
    return result;
  }, {});
  const set = (kindId: string, key: keyof TicketCounts, value: number) =>
    setTickets({ ...tickets, [kindId]: { ...tickets[kindId], [key]: value } });

  // Payments come from the props, so they follow what is saved while the dialog is open.
  const totals = playerTotals(kinds, tickets);
  const worth = ticketValue(kinds, tickets, ticketsKept);
  const newAmount = Math.max(0, Math.round(Number(amount) || 0));
  // What is left before the new amount, which the "Allt" button fills in.
  const owedBefore = amountOwed(kinds, tickets, player.paid);
  const owed = owedBefore - newAmount;
  const overdrawn = kinds.some((kind) => ticketsKept(tickets[kind.id]) < 0);
  const seenTotals = playerTotals(kinds, seenTickets);
  const showHandOut = seenTotals.handedOut === 0 && usualHandOut(kinds).length > 0;
  // Only before anything is paid or handed back, so no money is lost from the records.
  const canUndo = seenTotals.handedOut > 0 && seenTotals.returned === 0 && player.payments.length === 0;
  const canRemove = seenTotals.handedOut === 0 && player.payments.length === 0;

  if (confirming) {
    return (
      <form action={confirmAction} className="space-y-4">
        <input type="hidden" name="lotteryId" value={lotteryId} />
        <input type="hidden" name="playerId" value={player.id} />
        <p className="text-sm">
          {confirming === "undo"
            ? `Ångra utdelningen? Spelarens ${seenTotals.handedOut} ${ticketWord(seenTotals.handedOut)} tas bort från försäljningen.`
            : "Ta bort spelaren från försäljningen? Du kan lägga till spelaren igen längst ner i listan."}
        </p>
        <FormError state={confirmState} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirming(null)} className={secondaryButtonClass}>
            Avbryt
          </button>
          <button type="submit" disabled={confirmPending} className={dangerButtonClass}>
            {confirming === "undo"
              ? confirmPending
                ? "Ångrar…"
                : "Ångra utdelningen"
              : confirmPending
                ? "Tar bort…"
                : "Ta bort"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      {player.handedOutAt && (
        <p className="text-sm text-muted">Utdelat {formatHandedOutAt(player.handedOutAt)}</p>
      )}
      {showHandOut && (
        <form action={handOutAction} className="space-y-2">
          <input type="hidden" name="lotteryId" value={lotteryId} />
          <input type="hidden" name="playerId" value={player.id} />
          <button type="submit" disabled={handingOut || pending} className={`${buttonClass} w-full`}>
            {handingOut ? "Delar ut…" : `Dela ut ${kindsSentence(kinds)}`}
          </button>
          <FormError state={handOutState} />
        </form>
      )}

      <form id={formId} action={action} className="space-y-4">
        <input type="hidden" name="lotteryId" value={lotteryId} />
        <input type="hidden" name="playerId" value={player.id} />
        {seenTotals.handedOut > 0 && <h4 className="text-sm font-semibold">Lotter</h4>}

        {kinds.map((kind) => {
          const counts = tickets[kind.id];
          const seen = seenTickets[kind.id] ?? noTickets;
          return (
            <fieldset key={kind.id} className="space-y-2">
              <input type="hidden" name="kindId" value={kind.id} />
              <input type="hidden" name={`previous.handedOut.${kind.id}`} value={seen.handedOut} />
              <input type="hidden" name={`previous.returned.${kind.id}`} value={seen.returned} />
              {kinds.length > 1 && (
                <legend className="pb-1 text-sm">
                  {kind.name} <span className="text-muted">· {formatKronor(kind.ticketPrice)}</span>
                </legend>
              )}
              <Stepper name={`handedOut.${kind.id}`} label="Utdelade" value={counts.handedOut} onChange={(value) => set(kind.id, "handedOut", value)} />
              <Stepper name={`returned.${kind.id}`} label="Tillbaka" value={counts.returned} onChange={(value) => set(kind.id, "returned", value)} />
            </fieldset>
          );
        })}
        {overdrawn && (
          <p className="text-sm text-red-600 dark:text-red-400">Tillbaka kan inte vara fler än de utdelade.</p>
        )}
      </form>

      {seenTotals.handedOut > 0 && (
        <Payments
          lotteryId={lotteryId}
          player={player}
          formId={formId}
          amount={amount}
          onAmountChange={setAmount}
          owed={owedBefore}
        />
      )}

      {totals.handedOut > 0 && (
        <div className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
          <p className="flex justify-between">
            <span>Lotternas värde</span>
            <span className="tabular-nums">{formatKronor(worth)}</span>
          </p>
          <p className="flex justify-between">
            <span>Inlämnat</span>
            <span className="tabular-nums">−{formatKronor(player.paid + newAmount)}</span>
          </p>
          <p className="flex justify-between border-t border-black/10 pt-1 font-semibold dark:border-white/10">
            <span>{owed > 0 ? "Kvar att redovisa" : owed < 0 ? "Inlämnat för mycket" : "Allt redovisat"}</span>
            <span className="tabular-nums">{formatKronor(Math.abs(owed))}</span>
          </p>
        </div>
      )}
      {totals.handedOut === 0 && !showHandOut && <p className="text-sm text-muted">Inga lotter utdelade.</p>}

      <FormError state={state} />
      <div className="flex items-center justify-end gap-2">
        {canUndo && (
          <button type="button" onClick={() => setConfirming("undo")} className="mr-auto text-sm text-red-600 underline dark:text-red-400">
            Ångra utdelningen
          </button>
        )}
        {canRemove && (
          <button type="button" onClick={() => setConfirming("remove")} className="mr-auto text-sm text-red-600 underline dark:text-red-400">
            Ta bort ur försäljningen
          </button>
        )}
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          Avbryt
        </button>
        <button type="submit" form={formId} disabled={pending || handingOut || overdrawn} className={buttonClass}>
          {pending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </div>
  );
}

/** Adds a player who isn't in the sale, such as one who isn't active or was taken out. */
export function AddLotteryPlayerForm({ lotteryId, players }: { lotteryId: string; players: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addToLottery, {});
  return (
    <form action={action} className="space-y-2 pt-2">
      <input type="hidden" name="lotteryId" value={lotteryId} />
      <div className="flex gap-2">
        <select
          name="playerId"
          required
          defaultValue=""
          aria-label="Spelare att lägga till"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-2 text-sm dark:border-white/10"
        >
          <option value="" disabled>
            Lägg till en spelare
          </option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Lägger till…" : "Lägg till"}
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export function CloseLotteryButton({ lotteryId, closed }: { lotteryId: string; closed: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const label = closed ? "Öppna igen" : "Avsluta försäljningen";
  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={secondaryButtonClass}>
        {label}
      </button>
      <Dialog
        dialogRef={dialogRef}
        title={closed ? "Öppna försäljningen igen?" : "Avsluta försäljningen?"}
        text={
          closed
            ? "Då går det att dela ut lotter och ändra siffrorna igen."
            : "Då går det inte längre att dela ut lotter eller ändra siffrorna, förrän någon öppnar den igen."
        }
      >
        <form action={setLotteryClosed} onSubmit={() => dialogRef.current?.close()} className="flex justify-end gap-2">
          <input type="hidden" name="lotteryId" value={lotteryId} />
          <input type="hidden" name="closed" value={closed ? "false" : "true"} />
          <button type="button" onClick={() => dialogRef.current?.close()} className={secondaryButtonClass}>
            Avbryt
          </button>
          <button type="submit" className={buttonClass}>
            {label}
          </button>
        </form>
      </Dialog>
    </>
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
