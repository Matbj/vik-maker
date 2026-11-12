/** One player's tickets of a kind in a lottery, or the sum of several. */
export type TicketCounts = { handedOut: number; returned: number };

/** "none" before any tickets are handed out, "out" while the player owes money, then "done". */
export type TicketStatus = "none" | "out" | "done";

/** Tickets not handed back, so either sold or still with the player. Payments settle them by value. */
export function ticketsKept(counts: TicketCounts) {
  return counts.handedOut - counts.returned;
}

export function sumTickets(rows: TicketCounts[]): TicketCounts {
  return rows.reduce(
    (sum, row) => ({ handedOut: sum.handedOut + row.handedOut, returned: sum.returned + row.returned }),
    { handedOut: 0, returned: 0 },
  );
}

const kronorFormat = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

export function formatKronor(amount: number) {
  return kronorFormat.format(amount);
}

const dueFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", day: "numeric", month: "long" });

/** A `date` column's "2026-12-01" as "1 december". */
export function formatDueOn(dueOn: string) {
  return dueFormat.format(new Date(`${dueOn}T00:00:00Z`));
}

const handedOutFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  day: "numeric",
  month: "long",
});

/** When a player was handed tickets, such as "12 november". */
export function formatHandedOutAt(at: Date) {
  return handedOutFormat.format(at);
}

export function ticketWord(count: number) {
  return count === 1 ? "lott" : "lotter";
}

/**
 * One kind of ticket in a sale, such as Bingolotter. `teamShare` is what the team keeps of each
 * ticket, in kronor, or null when not known.
 */
export type LotteryKindInfo = {
  id: string;
  name: string;
  ticketPrice: number;
  teamShare: number | null;
  ticketsPerPlayer: number | null;
};

/** A player's tickets in a sale, by kind id. A kind they haven't been handed is missing. */
export type KindCounts = Record<string, TicketCounts>;

export const noTickets: TicketCounts = { handedOut: 0, returned: 0 };

export function playerTotals(kinds: LotteryKindInfo[], tickets: KindCounts) {
  return sumTickets(kinds.map((kind) => tickets[kind.id] ?? noTickets));
}

/** What the picked tickets are worth, such as `ticketsKept` for what the player should hand in. */
export function ticketValue(
  kinds: LotteryKindInfo[],
  tickets: KindCounts,
  pick: (counts: TicketCounts) => number,
) {
  return kinds.reduce((sum, kind) => sum + pick(tickets[kind.id] ?? noTickets) * kind.ticketPrice, 0);
}

/** The kinds that have a usual number per player, which is what handing out gives. */
export function usualHandOut(kinds: LotteryKindInfo[]) {
  return kinds.filter((kind) => kind.ticketsPerPlayer !== null);
}

/** What the team keeps of the picked tickets, counting a kind without a share as nothing. */
export function teamValue(
  kinds: LotteryKindInfo[],
  tickets: KindCounts,
  pick: (counts: TicketCounts) => number,
) {
  return kinds.reduce((sum, kind) => sum + pick(tickets[kind.id] ?? noTickets) * (kind.teamShare ?? 0), 0);
}

/** What a player still owes: their kept tickets' value less what they have paid. Negative if they paid more. */
export function amountOwed(kinds: LotteryKindInfo[], tickets: KindCounts, paid: number) {
  return ticketValue(kinds, tickets, ticketsKept) - paid;
}

export function ticketStatus(kinds: LotteryKindInfo[], tickets: KindCounts, paid: number): TicketStatus {
  if (playerTotals(kinds, tickets).handedOut === 0) return "none";
  return amountOwed(kinds, tickets, paid) > 0 ? "out" : "done";
}

/**
 * The team's part of an amount paid for a player's tickets. Which tickets were sold isn't known,
 * so it uses the share of the kept tickets' value, which is exact when every kind has the same
 * share of its price.
 */
export function teamPart(kinds: LotteryKindInfo[], tickets: KindCounts, amount: number) {
  const value = ticketValue(kinds, tickets, ticketsKept);
  return value > 0 ? Math.round((amount * teamValue(kinds, tickets, ticketsKept)) / value) : 0;
}

/** Whether `teamPart` is only an estimate, as the kinds keep different shares of their price. */
export function teamPartIsEstimate(kinds: LotteryKindInfo[]) {
  const ratios = new Set(kinds.map((kind) => (kind.ticketPrice > 0 ? (kind.teamShare ?? 0) / kind.ticketPrice : 0)));
  return ratios.size > 1;
}
