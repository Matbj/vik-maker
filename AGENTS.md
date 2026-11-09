<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VIK Playmaker

A mobile-first tool for the coaches of a youth football team (`vendelsoik-p10` on svenskalag.se). It syncs workouts and attendance from svenskalag.se and builds leveled training groups and teams from each player's level (A, B1, B2, C).

## Keep this file up to date

This file describes the app as it is now. When a change affects anything below (routes, data model, env vars, integrations, scripts, deployment or rules), update this file in the same commit. Describe the current state, not the history. See `README.md` for setup steps.

## Language

- All code is in English: identifiers, comments, database names, AI prompts, commit messages and docs. Page routes are the exception, as their folder names are the addresses users see.
- Everything users see is in Swedish: page addresses (without å, ä and ö), page text, buttons, form and error messages that reach the UI (including those thrown in `src/lib/`), page metadata, the login email and `<html lang>`.
- Data keeps its own language, such as svenskalag.se titles and the group names.
- Use the words coaches know from svenskalag.se and football: workout is "träning", coach is "ledare", team is "lag", league is "serie".

## Branding

The app is called VIK Playmaker, for Vendelsö IK. Colors come from the club's crest, blue `#0053a1` and yellow `#ffd100`, and are defined as theme tokens in `src/app/globals.css`. Use `bg-accent` with `text-on-accent`, as the accent is blue in light mode and yellow in dark mode. The crest is `src/assets/vik-crest.png`, with `src/app/icon.png` and `src/app/apple-icon.png` as icons. `src/proxy.ts` must keep letting the icons through without a login.

## Standing rules

- **svenskalag.se is read-only.** The only allowed POST is the login. Never submit forms or RSVPs, and never call `/schedules/invites/send`, `/{team}/invites/savereply`, `/{team}/invites/removeattendance/*` or save the `chooseparticipants` form.
- **Never store or log raw svenskalag.se pages.** They contain parents' phone numbers. Keep the `workouts.raw` column unused for that reason. Don't read the "Spelare" section of the contact list, and don't use `/api/v1/{team}/schedules/{id}/invites/members`, which returns the whole club.
- **The AI only gets anonymous ids, never children's names.** `src/lib/grouping/claude-groups.ts` swaps player ids for throwaway aliases before each call. Coach notes are sent as written, so the Settings page must keep telling coaches not to use names in them.
- **Credentials live only in the gitignored `.env.local`** and in Vercel's env vars. Never commit them or put them in chat.
- **No Claude or Anthropic branding in the UI.** Those names are fine in code.
- **Mobile first.** Design for phones, with Tailwind v4.

## Stack

Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS v4, Neon Postgres with Drizzle ORM, Anthropic SDK, Zod, and Resend for email. The dev server runs on port 8100.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Workouts |
| `/traningar/[id]` | One workout: attendance, leveled groups, teams, spreading new players |
| `/truppen` | The coaches with roles and phone numbers, then active players and their levels |
| `/installningar` | Keep-apart pairs and free-text grouping notes |
| `/logga-in` | Email code login for coaches |
| `/api/cron/sync-svenskalag` | Daily sync at 14:00 UTC, protected by `CRON_SECRET` |

`src/proxy.ts` requires a logged-in coach for every page and Server Action, except `/api/cron/`. `next.config.ts` redirects the old English addresses to these.

## How it works

- **Sync** (`src/lib/svenskalag/`): logs in with a coach's own account and parses the pages, as there is no public API. It covers the last 14 days and the next 28, and a page that looks wrong fails the sync instead of overwriting data. It never changes a player's level or active flag. Coach emails, phone numbers and roles come from the "Ledare" section of the contact list, and only coaches' numbers are stored. Workouts removed from svenskalag.se aren't deleted here yet.
- **Attendance**: `player_response` is what the player answered, and `coach_check` is the coaches' own check, empty until registered. The check wins once it exists.
- **Groups and teams** (`src/lib/grouping/`): the AI proposes them, and pure functions in `level-groups.ts` and `teams.ts` validate the answer, with up to three attempts. Nobody moves more than one level from their home level. Keep-apart pairs get the same retries, but the last answer is accepted if it only misses those. Groups are named after Greek or Norse gods, starting with the letter of the group's strongest level. When a workout has leveled groups, a checkbox on the team form asks the AI to keep the teams as close to those groups as possible, which then comes before even strength between teams from different groups.
- **Persistence**: groups stay per workout and kind until a coach creates new ones. Players who stop coming stay in their group and are marked, and new players are listed separately so they can be spread into the existing groups.
- **Login** (`src/lib/auth/`): a 4-character code emailed through Resend, valid for 10 minutes. Three wrong tries use up the code, a coach can get 5 codes per hour, and sessions last 90 days. Only hashes of codes and session tokens are stored.

## Data model

Defined in `src/db/schema.ts`: `levels`, `players`, `coaches`, `workouts`, `workout_attendance`, `workout_coach_attendance`, `workout_groups`, `workout_group_members`, `player_separations`, `app_settings`, `login_codes`, `sessions`.

## Code conventions

- Pages read data in async server components, inside `Suspense`, after `await connection()`.
- Mutations are Server Actions in an `actions.ts` next to the route, validated with Zod, used through `useActionState` and followed by `revalidatePath`.
- Server code that touches secrets imports `server-only`, and env vars go through `src/lib/env.ts`.
- Add new env vars to `.env.example` too.
- Only messages from a `UserError` (`src/lib/errors.ts`) are shown to coaches. Other errors are logged and replaced by a general Swedish message.

## Database and deployment

- Change `src/db/schema.ts`, then run `npm run db:generate`. Don't edit applied migrations.
- Production builds apply migrations and seed levels before the new code is live, so migrations must stay backward compatible.
- `DATABASE_URL` in `.env.local` points at the Neon dev branch `mattias`. `DATABASE_URL_PROD` is production, so ask before running anything against it.
- Hosted on Vercel, scope `mattias-projects-dc0be416`, production environment only.
- Required env vars are listed in `.env.example`.

## Checks

There are no automated tests yet. Run `npm run lint` and `npm run typecheck` before committing.
