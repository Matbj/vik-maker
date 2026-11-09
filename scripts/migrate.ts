import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: ".env.local" });

export async function runMigrations() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local)");
  await migrate(drizzle(neon(url)), { migrationsFolder: "drizzle" });
  console.log("migrations applied");
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
