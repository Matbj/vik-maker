import { Suspense } from "react";
import { connection } from "next/server";
import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { LogoutButton } from "@/components/logout-button";
import { Notice } from "@/components/notice";
import { loadGroupingPreferences } from "@/lib/grouping/preferences";
import { removeSeparation } from "./actions";
import { AddSeparationForm, GroupingNotesForm, SyncForm } from "./settings-forms";

// The sync started from here reads every workout from svenskalag.se, like the daily one.
export const maxDuration = 300;

export default function SettingsPage() {
  return (
    <section className="space-y-6">
      <Suspense fallback={<p className="text-sm text-muted">Laddar inställningar…</p>}>
        <Settings />
      </Suspense>
      <LogoutButton />
    </section>
  );
}

/** When the daily sync in `vercel.json` runs, 14:00 UTC, on a Swedish clock. */
function dailySyncTime() {
  const at = new Date();
  at.setUTCHours(14, 0, 0, 0);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(at);
}

async function Settings() {
  await connection();

  if (!env.DATABASE_URL) {
    return <Notice title="Databasen är inte konfigurerad">Lägg till <code>DATABASE_URL</code> i <code>.env.local</code>.</Notice>;
  }

  const db = getDb();
  const playerA = alias(schema.players, "player_a");
  const playerB = alias(schema.players, "player_b");
  const [players, pairs, { notes }] = await Promise.all([
    db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(eq(schema.players.active, true))
      .orderBy(asc(schema.players.name)),
    db
      .select({
        playerAId: schema.playerSeparations.playerAId,
        playerBId: schema.playerSeparations.playerBId,
        nameA: playerA.name,
        nameB: playerB.name,
      })
      .from(schema.playerSeparations)
      .innerJoin(playerA, eq(playerA.id, schema.playerSeparations.playerAId))
      .innerJoin(playerB, eq(playerB.id, schema.playerSeparations.playerBId))
      .orderBy(asc(playerA.name), asc(playerB.name)),
    loadGroupingPreferences(),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Håll isär</h2>
          <p className="text-sm text-muted">Vi gör vårt bästa för att hålla de här spelarna i olika grupper och lag, men det kan inte garanteras om det inte finns något rimligt sätt att göra det.</p>
        </div>
        <AddSeparationForm players={players} />
        {pairs.length > 0 && (
          <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
            {pairs.map((pair) => (
              <li key={`${pair.playerAId}-${pair.playerBId}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0">
                  {pair.nameA} <span className="text-muted">och</span> {pair.nameB}
                </span>
                <form action={removeSeparation}>
                  <input type="hidden" name="playerAId" value={pair.playerAId} />
                  <input type="hidden" name="playerBId" value={pair.playerBId} />
                  <button type="submit" className="text-sm font-medium text-red-600 dark:text-red-400">
                    Ta bort
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Anteckningar för gruppindelning</h2>
          <p className="text-sm text-muted">
            Anteckningarna följs när grupper och lag skapas. Skriv inga barns namn här, använd
            Håll isär till det, eftersom anteckningarna delas ordagrant med en extern AI-tjänst.
          </p>
        </div>
        <GroupingNotesForm initialNotes={notes} />
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Synkning</h2>
          <p className="text-sm text-muted">
            Träningar, svar, närvaro och ledare hämtas från svenskalag.se varje dag klockan{" "}
            {dailySyncTime()}. Här kan du hämta dem direkt.
          </p>
        </div>
        <SyncForm />
      </div>
    </div>
  );
}
