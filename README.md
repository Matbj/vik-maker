# Vik Maker

A mobile-first support tool for the team's coaches. It reads booked workouts from
[svenskalag.se](https://www.svenskalag.se) and builds leveled training groups from the
coaches' mapping of players to levels **A, B1, B2 and C**.

## Stack

- Next.js 16 (App Router, TypeScript, Cache Components)
- Tailwind CSS v4, mobile-first
- Neon Postgres + Drizzle ORM

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (and svenskalag vars later)
npm run db:migrate           # apply migrations in ./drizzle
npm run db:seed              # create the A, B1, B2, C levels
npm run dev
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema directly (quick prototyping only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed default levels |

## Layout

```
src/
  app/                    routes (Workouts = /, Players = /players)
  components/             shared UI
  db/schema.ts            levels, players, workouts, attendance, workout groups
  db/index.ts             lazy Neon/Drizzle client (server-only)
  lib/env.ts              validated server env
  lib/grouping/           pure group-building logic
  lib/svenskalag/         svenskalag.se client + sync (placeholder)
drizzle/                  SQL migrations
scripts/seed.ts           seeds levels
```

## Data model

- **levels**: A, B1, B2, C (a table, so levels can be renamed or added without a migration)
- **players**: name, svenskalag id, level
- **workouts**: synced from svenskalag.se, keyed on svenskalag's id
- **workout_attendance**: who booked / declined each workout
- **workout_groups** + **workout_group_members**: the generated groups for a workout

## svenskalag.se integration

There is no public API, so the integration logs in with a coach's own account and reads
the pages (or the JSON endpoints those pages call). It lives in `src/lib/svenskalag/` and is
**server-only**: credentials come from env vars (`SVENSKALAG_*`), session cookies stay in
server memory, and nothing is ever committed. It is read-only towards svenskalag.se.
The client is currently a stub; see the comments in `client.ts` for the planned approach.
