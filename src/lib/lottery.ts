/** One player's tickets in a lottery, or the sum of several players'. */
export type TicketCounts = { handedOut: number; paid: number; returned: number };

/** "none" before any tickets are handed out, "out" while some are unaccounted for, then "done". */
export type TicketStatus = "none" | "out" | "done";

/** Tickets the player still has, neither paid for nor handed back. */
export function ticketsLeft(counts: TicketCounts) {
  return counts.handedOut - counts.paid - counts.returned;
}

export function ticketStatus(counts: TicketCounts): TicketStatus {
  if (counts.handedOut === 0) return "none";
  return ticketsLeft(counts) > 0 ? "out" : "done";
}

export function sumTickets(rows: TicketCounts[]): TicketCounts {
  return rows.reduce(
    (sum, row) => ({
      handedOut: sum.handedOut + row.handedOut,
      paid: sum.paid + row.paid,
      returned: sum.returned + row.returned,
    }),
    { handedOut: 0, paid: 0, returned: 0 },
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

export function ticketWord(count: number) {
  return count === 1 ? "lott" : "lotter";
}

/** One kind of ticket in a sale, such as Bingolotter. */
export type LotteryKindInfo = { id: string; name: string; ticketPrice: number; ticketsPerPlayer: number | null };

/** A player's tickets in a sale, by kind id. A kind they haven't been handed is missing. */
export type KindCounts = Record<string, TicketCounts>;

export const noTickets: TicketCounts = { handedOut: 0, paid: 0, returned: 0 };

export function playerTotals(kinds: LotteryKindInfo[], tickets: KindCounts) {
  return sumTickets(kinds.map((kind) => tickets[kind.id] ?? noTickets));
}

/** What the picked tickets are worth, such as `ticketsLeft` for what the player may still pay. */
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

/** "Dela ut 20" for one kind, "Dela ut 10 + 15" for several. */
export function handOutLabel(kinds: LotteryKindInfo[]) {
  return `Dela ut ${usualHandOut(kinds)
    .map((kind) => kind.ticketsPerPlayer)
    .join(" + ")}`;
}
