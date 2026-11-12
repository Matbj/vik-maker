import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { LiveUpdates } from "@/components/live-updates";
import { realtimeUrl, sealLotteryLiveQueries } from "@/lib/realtime/live-queries";
import {
  formatDueOn,
  formatKronor,
  sumTickets,
  ticketsLeft,
  ticketValue,
  ticketWord,
  type TicketCounts,
} from "@/lib/lottery";
import {
  AddLotteryPlayerForm,
  CloseLotteryButton,
  DeleteLotteryButton,
  LotteryForm,
  LotteryPlayers,
  type LotteryPlayer,
} from "../lottery-forms";

export default function LotteryPage({ params }: PageProps<"/truppen/lotter/[id]">) {
  return (
    <section className="space-y-6">
      <Link href="/truppen/lotter" className="inline-block text-sm text-muted">
        ← Lotter
      </Link>
      <Suspense fallback={<p className="text-sm text-muted">Laddar försäljningen…</p>}>
        <Lottery params={params} />
      </Suspense>
    </section>
  );
}

async function Lottery({ params }: { params: PageProps<"/truppen/lotter/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const { lotteries, lotteryKinds, lotteryPlayers, lotteryTickets, players } = schema;
  const [[lottery], kinds, tickets, allPlayers, changes, liveQueries] = await Promise.all([
    db.select().from(lotteries).where(eq(lotteries.id, id)),
    db
      .select({
        id: lotteryKinds.id,
        name: lotteryKinds.name,
        ticketPrice: lotteryKinds.ticketPrice,
        teamShare: lotteryKinds.teamShare,
        ticketsPerPlayer: lotteryKinds.ticketsPerPlayer,
      })
      .from(lotteryKinds)
      .where(eq(lotteryKinds.lotteryId, id))
      .orderBy(asc(lotteryKinds.sortOrder)),
    db
      .select({
        kindId: lotteryTickets.kindId,
        playerId: lotteryTickets.playerId,
        handedOut: lotteryTickets.handedOut,
        paid: lotteryTickets.paid,
        returned: lotteryTickets.returned,
        handedOutAt: lotteryTickets.handedOutAt,
      })
      .from(lotteryTickets)
      .innerJoin(lotteryKinds, eq(lotteryKinds.id, lotteryTickets.kindId))
      .where(eq(lotteryKinds.lotteryId, id)),
    db
      .select({ id: players.id, name: players.name, active: players.active })
      .from(players)
      .orderBy(asc(players.name)),
    db
      .select({ playerId: lotteryPlayers.playerId, included: lotteryPlayers.included })
      .from(lotteryPlayers)
      .where(eq(lotteryPlayers.lotteryId, id)),
    sealLotteryLiveQueries(id),
  ]);
  if (!lottery) notFound();
  const liveUrl = realtimeUrl();

  // Every active player unless a coach left them out, anyone a coach added, and anyone with tickets.
  const holders = new Set(tickets.filter((row) => row.handedOut > 0).map((row) => row.playerId));
  const included = new Map(changes.map((change) => [change.playerId, change.included]));
  const inSale = (player: (typeof allPlayers)[number]) =>
    holders.has(player.id) || (included.get(player.id) ?? player.active);
  const addable = allPlayers.filter((player) => !inSale(player)).map(({ id, name }) => ({ id, name }));
  const rows: LotteryPlayer[] = allPlayers.filter(inSale).map(({ id, name }) => ({ id, name })).map((player) => {
    const own = tickets.filter((row) => row.playerId === player.id);
    const handedOutAt = own.flatMap((row) => (row.handedOutAt ? [row.handedOutAt.getTime()] : []));
    return {
      ...player,
      tickets: Object.fromEntries(own.map(({ kindId, handedOut, paid, returned }) => [kindId, { handedOut, paid, returned }])),
      // The first time, if kinds were handed out on different days.
      handedOutAt: handedOutAt.length > 0 ? new Date(Math.min(...handedOutAt)) : null,
    };
  });

  const closed = lottery.closedAt !== null;
  const all = tickets.map((row) => ({ [row.kindId]: row }));
  const value = (pick: (counts: TicketCounts) => number) =>
    all.reduce((sum, row) => sum + ticketValue(kinds, row, pick), 0);
  const totals = sumTickets(tickets);
  const withShare = kinds.filter((kind) => kind.teamShare !== null);
  const missingShare = kinds.filter((kind) => kind.teamShare === null);
  const earned = tickets.reduce(
    (sum, row) => sum + row.paid * (kinds.find((kind) => kind.id === row.kindId)?.teamShare ?? 0),
    0,
  );
  const left = ticketsLeft(totals);

  return (
    <div className="space-y-6">
      {liveUrl && liveQueries && (
        <LiveUpdates key={id} renewUrl={`/api/realtime/lotteries/${id}`} url={liveUrl} initialQueries={liveQueries} />
      )}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{lottery.name}</h2>
        <p className="text-sm text-muted">
          {kinds.map((kind) => `${kind.name} ${formatKronor(kind.ticketPrice)}`).join(" · ")}
          {lottery.dueOn && <> · sista dag {formatDueOn(lottery.dueOn)}</>}
          {closed && " · avslutad"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Insamlat" value={formatKronor(value((counts) => counts.paid))} accent />
        {withShare.length > 0 && (
          <Stat
            label="Intjänat till laget"
            value={formatKronor(earned)}
            detail={missingShare.length > 0 ? `Lagets del saknas för ${missingShare.map((kind) => kind.name).join(" och ")}` : undefined}
            accent
          />
        )}
        <Stat
          className={withShare.length > 0 ? "col-span-2" : undefined}
          label="Kvar ute"
          value={`${left} ${ticketWord(left)}`}
          detail={left > 0 ? `${formatKronor(value(ticketsLeft))} om de säljs` : undefined}
        />
      </dl>

      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 font-normal">Sort</th>
            <th className="py-1 text-right font-normal">Utdelade</th>
            <th className="py-1 text-right font-normal">Betalda</th>
            <th className="py-1 text-right font-normal">Tillbaka</th>
            <th className="py-1 text-right font-normal">Kvar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {kinds.map((kind) => {
            const kindTotals = sumTickets(tickets.filter((row) => row.kindId === kind.id));
            return (
              <tr key={kind.id}>
                <td className="py-2 pr-2">{kind.name}</td>
                <td className="py-2 text-right tabular-nums">{kindTotals.handedOut}</td>
                <td className="py-2 text-right tabular-nums">{kindTotals.paid}</td>
                <td className="py-2 text-right tabular-nums">{kindTotals.returned}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{ticketsLeft(kindTotals)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Spelare</h2>
        {!closed && <p className="text-sm text-muted">Tryck på en spelare för att dela ut lotter eller registrera vad som är betalt och tillbakalämnat.</p>}
        <LotteryPlayers lotteryId={lottery.id} kinds={kinds} closed={closed} players={rows} />
        {!closed && addable.length > 0 && <AddLotteryPlayerForm lotteryId={lottery.id} players={addable} />}
      </div>

      {!closed && (
        <details className="rounded-xl border border-black/10 dark:border-white/10">
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">Ändra försäljningen</summary>
          <div className="border-t border-black/10 p-4 dark:border-white/10">
            <LotteryForm
              // Starts over after a save, so new kinds get their ids.
              key={kinds.map((kind) => kind.id).join()}
              lottery={{ id: lottery.id, name: lottery.name, dueOn: lottery.dueOn, kinds }}
            />
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <CloseLotteryButton lotteryId={lottery.id} closed={closed} />
        <DeleteLotteryButton lotteryId={lottery.id} name={lottery.name} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  accent,
  className = "",
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-black/10 px-4 py-3 dark:border-white/10 ${className}`}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${accent ? "text-accent" : ""}`}>{value}</dd>
      {detail && <dd className="text-xs text-muted">{detail}</dd>}
    </div>
  );
}
