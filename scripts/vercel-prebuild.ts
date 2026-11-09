import { runMigrations } from "./migrate";
import { seedLevels } from "./seed";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
    return;
  }
  await runMigrations();
  await seedLevels();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
