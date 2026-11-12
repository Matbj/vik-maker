import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { Notice } from "@/components/notice";
import { formatDueOn, formatKronor, ticketWord } from "@/lib/lottery";
import { LotteryForm } from "./lottery-forms";

export default function LotteriesPage() {
  return (
    <section className="space-y-6">
      <Link href="/truppen" className="inline-block text-sm text-muted">
        ← Truppen
      </Link>
      <Suspense fallback={<p className="text-sm text-muted">Laddar lotterierna…</p>}>
        <Lotteries />
      </Suspense>
    </section>
  );
}

async function Lotteries() {
  await connection();

  if (!env.DATABASE_URL) {
    return <Notice title="Databasen är inte konfigurerad">Lägg till <code>DATABASE_URL</code> i <code>.env.local</code>.</Notice>;
  }

  const { lotteries, lotteryTickets } = schema;
  const rows = await getDb()
    .select({
      id: lotteries.id,
      name: lotteries.name,
      ticketPrice: lotteries.ticketPrice,
      dueOn: lotteries.dueOn,
      closedAt: lotteries.closedAt,
      handedOut: sql<number>`coalesce(sum(${lotteryTickets.handedOut}), 0)::int`,
      paid: sql<number>`coalesce(sum(${lotteryTickets.paid}), 0)::int`,
      playersWithTicketsLeft: sql<number>`count(*) filter (where ${lotteryTickets.handedOut} > ${lotteryTickets.paid} + ${lotteryTickets.returned})::int`,
    })
    .from(lotteries)
    .leftJoin(lotteryTickets, eq(lotteryTickets.lotteryId, lotteries.id))
    .groupBy(lotteries.id)
    .orderBy(desc(lotteries.createdAt));

  const open = rows.filter((row) => !row.closedAt);
  const closed = rows.filter((row) => row.closedAt);

  return (
    <div className="space-y-6">
      {rows.length === 0 && (
        <Notice title="Inga lotteriförsäljningar än">
          Skapa en försäljning nedan, till exempel Bingolotter till jul. Sedan håller du koll på hur många lotter
          varje spelare har fått, vad som är betalt och vad som har lämnats tillbaka.
        </Notice>
      )}
      {open.length > 0 && <LotteryList title="Pågående" lotteries={open} />}

      <details className="group rounded-xl border border-black/10 dark:border-white/10" open={rows.length === 0}>
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold">
          <span className="text-accent">+</span> Ny lotteriförsäljning
        </summary>
        <div className="border-t border-black/10 p-4 dark:border-white/10">
          <LotteryForm />
        </div>
      </details>

      {closed.length > 0 && <LotteryList title="Avslutade" lotteries={closed} />}
    </div>
  );
}

function LotteryList({
  title,
  lotteries,
}: {
  title: string;
  lotteries: {
    id: string;
    name: string;
    ticketPrice: number;
    dueOn: string | null;
    closedAt: Date | null;
    handedOut: number;
    paid: number;
    playersWithTicketsLeft: number;
  }[];
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="space-y-2">
        {lotteries.map((lottery) => (
          <li key={lottery.id}>
            <Link
              href={`/truppen/lotter/${lottery.id}`}
              className="block rounded-xl border border-black/10 px-4 py-3 dark:border-white/10"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{lottery.name}</span>
                <span className="shrink-0 text-sm font-semibold text-accent">
                  {formatKronor(lottery.paid * lottery.ticketPrice)}
                </span>
              </span>
              <span className="mt-0.5 block text-sm text-muted">
                {lottery.paid} av {lottery.handedOut} {ticketWord(lottery.handedOut)} betalda
                {!lottery.closedAt && lottery.playersWithTicketsLeft > 0 && (
                  <>
                    {" · "}
                    {lottery.playersWithTicketsLeft}{" "}
                    spelare har lotter kvar
                  </>
                )}
                {!lottery.closedAt && lottery.dueOn && <> · sista dag {formatDueOn(lottery.dueOn)}</>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
