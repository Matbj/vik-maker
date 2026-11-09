import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { levels } from "../src/db/schema";

config({ path: ".env.local" });

const DEFAULT_LEVELS = [
  { code: "A", name: "A", sortOrder: 1 },
  { code: "B1", name: "B1", sortOrder: 2 },
  { code: "B2", name: "B2", sortOrder: 3 },
  { code: "C", name: "C", sortOrder: 4 },
];

export async function seedLevels() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local)");
  const db = drizzle(neon(url));
  await db.insert(levels).values(DEFAULT_LEVELS).onConflictDoNothing({ target: levels.code });
  console.log("Seeded levels:", DEFAULT_LEVELS.map((l) => l.code).join(", "));
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedLevels().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
