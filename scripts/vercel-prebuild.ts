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
  try {
    const { syncCoachEmails } = await import("../src/lib/svenskalag/sync");
    console.log("coach emails", await syncCoachEmails());
  } catch (err) {
    console.error("coach email sync failed, the daily sync will retry:", err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
