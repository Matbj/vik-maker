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
| `npm run dev` / `start` | Next.js |
| `npm run build` | Next.js build; on production Vercel deploys, applies migrations and seeds levels first |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:migrate:runtime` | Apply migrations with the script used in production builds (prefers `DATABASE_URL_UNPOOLED`) |
| `npm run db:push` | Push schema directly (quick prototyping only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed default levels |
| `npm run sync:svenskalag` | Sync workouts and attendance now (`-- --dry-run` reads svenskalag.se and prints counts without writing) |

Production deploys apply migrations automatically during the build. Migrations must stay
backward compatible, because they run before the new code is live.

## Layout

```
src/
  app/                    routes (Workouts = /, Players = /players)
  components/             shared UI
  db/schema.ts            levels, players, workouts, attendance, workout groups
  db/index.ts             lazy Neon/Drizzle client (server-only)
  lib/env.ts              validated server env
  lib/grouping/           AI leveled groups, team building and their rules
  lib/svenskalag/         svenskalag.se client, page parsers and sync
drizzle/                  SQL migrations
scripts/seed.ts           seeds levels
```

## Data model

- **levels**: A, B1, B2, C (a table, so levels can be renamed or added without a migration)
- **players**: name, svenskalag id, level
- **workouts**: synced from svenskalag.se, keyed on svenskalag's id
- **workout_attendance**: per workout and player, `player_response` (what the player answered) and `coach_check` (the coaches' attendance check, empty until registered)
- **workout_groups** + **workout_group_members**: the generated leveled groups and teams for a workout, kept until a coach creates new ones

## Groups and teams

On a workout's page, coaches create groups by hand, and they stay until replaced.

- **Leveled groups** are computed by Claude from each player's level and recent attendance and
  groups. It rotates some players up or down so groups don't go stale. Code checks the result:
  nobody ever moves more than one level. Players are sent as anonymous ids, never names.
- **Teams** are built without AI: players are dealt out by level so teams are even, and any
  players beyond the requested size are listed as reserves. With 4 or more teams they can be
  split into two leagues by level.

## svenskalag.se integration

There is no public API, so the integration logs in with a coach's own account and reads
the pages (or the JSON endpoints those pages call). It lives in `src/lib/svenskalag/` and is
**server-only**: credentials come from env vars (`SVENSKALAG_*`), session cookies stay in
server memory, and nothing is ever committed. It is read-only towards svenskalag.se.

Trainings come from the monthly calendar. Each player's answer comes from the activity page,
and the coaches' check from the "Fyll i närvaro" page. A page that doesn't look as expected
fails the sync instead of overwriting data.

Vercel Cron calls `/api/cron/sync-svenskalag` once a day, covering the last 14 days and the
next 28. It needs `SVENSKALAG_USERNAME`, `SVENSKALAG_PASSWORD` and `CRON_SECRET` in the
Vercel project. A player's level is never changed by the sync.
