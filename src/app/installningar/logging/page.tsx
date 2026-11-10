import { Suspense } from "react";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit";
import { Notice } from "@/components/notice";

const MAX_ENTRIES = 200;

const whenFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "medium",
});

export default function AuditLogPage() {
  return (
    <section className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted">Laddar loggen…</p>}>
        <AuditLog />
      </Suspense>
    </section>
  );
}

async function AuditLog() {
  await connection();

  if (!env.DATABASE_URL) {
    return <Notice title="Databasen är inte konfigurerad">Lägg till <code>DATABASE_URL</code> i <code>.env.local</code>.</Notice>;
  }

  const entries = await getDb()
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(MAX_ENTRIES);

  if (entries.length === 0) return <p className="text-sm text-muted">Inget har loggats än.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Visar de senaste {MAX_ENTRIES} händelserna.</p>
      <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
        {entries.map((entry) => (
          <li key={entry.id} className="space-y-1 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{entry.coachName}</span>
              <time dateTime={entry.createdAt.toISOString()} className="shrink-0 text-xs text-muted">
                {whenFormat.format(entry.createdAt)}
              </time>
            </div>
            <p className="text-sm">{AUDIT_ACTIONS[entry.action as AuditAction] ?? entry.action}</p>
            {Object.keys(entry.details).length > 0 && (
              <pre className="overflow-x-auto rounded-lg bg-black/5 p-2 text-xs dark:bg-white/10">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
