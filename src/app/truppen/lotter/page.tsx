import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { Notice } from "@/components/notice";
import { formatDueOn, formatKronor } from "@/lib/lottery";
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

  const { rows } = await getDb().execute<{
    id: string;
    name: string;
    dueOn: string | null;
    closed: boolean;
    collected: number;
    owed: number;
    playersOwing: number;
  }>(sql`
    with worth as (
      select k.lottery_id, t.player_id, sum((t.handed_out - t.returned) * k.ticket_price) as amount
      from lottery_tickets t
      join lottery_kinds k on k.id = t.kind_id
      group by k.lottery_id, t.player_id
    ),
    paid as (
      select lottery_id, player_id, sum(amount) as amount
      from lottery_payments
      group by lottery_id, player_id
    ),
    balance as (
      select coalesce(w.lottery_id, p.lottery_id) as lottery_id,
        coalesce(w.amount, 0) - coalesce(p.amount, 0) as owed,
        coalesce(p.amount, 0) as paid
      from worth w
      full join paid p on p.lottery_id = w.lottery_id and p.player_id = w.player_id
    )
    select l.id, l.name, l.due_on::text as "dueOn", l.closed_at is not null as closed,
      coalesce(sum(b.paid), 0)::int as collected,
      coalesce(sum(greatest(b.owed, 0)), 0)::int as owed,
      count(*) filter (where b.owed > 0)::int as "playersOwing"
    from lotteries l
    left join balance b on b.lottery_id = l.id
    group by l.id
    order by l.created_at desc
  `);

  const open = rows.filter((row) => !row.closed);
  const closed = rows.filter((row) => row.closed);

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
    dueOn: string | null;
    closed: boolean;
    collected: number;
    owed: number;
    playersOwing: number;
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
                  {formatKronor(lottery.collected)}
                </span>
              </span>
              <span className="mt-0.5 block text-sm text-muted">
                Insamlat
                {lottery.owed > 0 && (
                  <>
                    {" · "}
                    {formatKronor(lottery.owed)} kvar hos {lottery.playersOwing} spelare
                  </>
                )}
                {!lottery.closed && lottery.dueOn && <> · sista dag {formatDueOn(lottery.dueOn)}</>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
