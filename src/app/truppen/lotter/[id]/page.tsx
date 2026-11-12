import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { formatDueOn, formatKronor, sumTickets, ticketsLeft, ticketWord } from "@/lib/lottery";
import {
  CloseLotteryButton,
  DeleteLotteryButton,
  HandOutToAllForm,
  LotteryForm,
  LotteryPlayers,
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
  const { lotteries, lotteryTickets, players } = schema;
  const [[lottery], rows] = await Promise.all([
    db.select().from(lotteries).where(eq(lotteries.id, id)),
    // Active players, and anyone else who still has tickets in this lottery.
    db
      .select({
        id: players.id,
        name: players.name,
        handedOut: sql<number>`coalesce(${lotteryTickets.handedOut}, 0)::int`,
        paid: sql<number>`coalesce(${lotteryTickets.paid}, 0)::int`,
        returned: sql<number>`coalesce(${lotteryTickets.returned}, 0)::int`,
      })
      .from(players)
      .leftJoin(lotteryTickets, and(eq(lotteryTickets.playerId, players.id), eq(lotteryTickets.lotteryId, id)))
      .where(or(eq(players.active, true), sql`${lotteryTickets.handedOut} > 0`))
      .orderBy(asc(players.name)),
  ]);
  if (!lottery) notFound();

  const closed = lottery.closedAt !== null;
  const totals = sumTickets(rows);
  const left = ticketsLeft(totals);
  const playersWithout = rows.filter((row) => row.handedOut === 0).length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{lottery.name}</h2>
        <p className="text-sm text-muted">
          {formatKronor(lottery.ticketPrice)} per lott
          {lottery.dueOn && <> · sista dag {formatDueOn(lottery.dueOn)}</>}
          {closed && " · avslutad"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Betalt" value={formatKronor(totals.paid * lottery.ticketPrice)} accent />
        <Stat
          label="Kvar ute"
          value={`${left} ${ticketWord(left)}`}
          detail={left > 0 ? `${formatKronor(left * lottery.ticketPrice)} om de säljs` : undefined}
        />
        <Stat label="Utdelade" value={`${totals.handedOut} ${ticketWord(totals.handedOut)}`} />
        <Stat
          label="Betalda · tillbaka"
          value={`${totals.paid} · ${totals.returned}`}
        />
      </dl>

      {!closed && (
        <HandOutToAllForm
          lotteryId={lottery.id}
          ticketsPerPlayer={lottery.ticketsPerPlayer}
          playersWithout={playersWithout}
        />
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Spelare</h2>
        {!closed && <p className="text-sm text-muted">Tryck på en spelare för att dela ut lotter eller registrera vad som är betalt och tillbakalämnat.</p>}
        <LotteryPlayers
          lotteryId={lottery.id}
          ticketPrice={lottery.ticketPrice}
          ticketsPerPlayer={lottery.ticketsPerPlayer}
          closed={closed}
          players={rows}
        />
      </div>

      {!closed && (
        <details className="rounded-xl border border-black/10 dark:border-white/10">
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">Ändra försäljningen</summary>
          <div className="border-t border-black/10 p-4 dark:border-white/10">
            <LotteryForm lottery={lottery} />
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

function Stat({ label, value, detail, accent }: { label: string; value: string; detail?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${accent ? "text-accent" : ""}`}>{value}</dd>
      {detail && <dd className="text-xs text-muted">{detail}</dd>}
    </div>
  );
}
