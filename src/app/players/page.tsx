import { Suspense } from "react";
import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { Notice } from "@/components/notice";

export default function PlayersPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Spelare</h1>
      <Suspense fallback={<p className="text-sm text-muted">Laddar spelare…</p>}>
        <PlayerList />
      </Suspense>
    </section>
  );
}

async function PlayerList() {
  await connection();

  if (!env.DATABASE_URL) {
    return (
      <Notice title="Databasen är inte konfigurerad">
        Lägg till <code>DATABASE_URL</code> i <code>.env.local</code> och kör sedan{" "}
        <code>npm run db:migrate</code> och <code>npm run db:seed</code>.
      </Notice>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.players.id,
      name: schema.players.name,
      level: schema.levels.code,
    })
    .from(schema.players)
    .leftJoin(schema.levels, eq(schema.players.levelId, schema.levels.id))
    .where(eq(schema.players.active, true))
    .orderBy(asc(schema.levels.sortOrder), asc(schema.players.name));

  if (rows.length === 0) {
    return <Notice title="Inga spelare än">Spelarna och deras nivåer listas här.</Notice>;
  }

  return (
    <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center justify-between px-4 py-3">
          <span>{p.name}</span>
          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
            {p.level ?? "–"}
          </span>
        </li>
      ))}
    </ul>
  );
}
