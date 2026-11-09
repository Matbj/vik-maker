import { Suspense } from "react";
import { connection } from "next/server";
import { asc, eq, isNotNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { Notice } from "@/components/notice";

const listClass =
  "divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10";

export default function TeamPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Laget</h1>
      <Suspense fallback={<p className="text-sm text-muted">Laddar laget…</p>}>
        <Team />
      </Suspense>
    </section>
  );
}

async function Team() {
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
  const [coaches, players] = await Promise.all([
    db
      .select({ id: schema.coaches.id, name: schema.coaches.name, phone: schema.coaches.phone })
      .from(schema.coaches)
      // The sync clears both for anyone no longer listed as a coach on svenskalag.se.
      .where(or(isNotNull(schema.coaches.phone), isNotNull(schema.coaches.email)))
      .orderBy(asc(schema.coaches.name)),
    db
      .select({
        id: schema.players.id,
        name: schema.players.name,
        level: schema.levels.code,
      })
      .from(schema.players)
      .leftJoin(schema.levels, eq(schema.players.levelId, schema.levels.id))
      .where(eq(schema.players.active, true))
      .orderBy(asc(schema.levels.sortOrder), asc(schema.players.name)),
  ]);

  return (
    <div className="space-y-6">
      {coaches.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Ledare</h2>
          <ul className={listClass}>
            {coaches.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span>{c.name}</span>
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="shrink-0 text-accent underline">
                    {c.phone}
                  </a>
                ) : (
                  <span className="shrink-0 text-muted">–</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Spelare</h2>
        {players.length === 0 ? (
          <Notice title="Inga spelare än">Spelarna och deras nivåer listas här.</Notice>
        ) : (
          <ul className={listClass}>
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3">
                <span>{p.name}</span>
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  {p.level ?? "–"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
