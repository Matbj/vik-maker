import { runMigrations } from "./migrate";
import { seedLevels } from "./seed";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
    return;
  }
  await runMigrations();
  await seedLevels();

  // Login goes by these emails, so have them in place before a deploy goes live.
  // Nothing is cleared here, as the names haven't been refreshed. The daily sync does that.
  try {
    const { syncCoachContacts } = await import("../src/lib/svenskalag/sync");
    console.log("coach contacts", await syncCoachContacts());
  } catch (err) {
    console.error("coach contact sync failed, the daily sync will retry:", err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
