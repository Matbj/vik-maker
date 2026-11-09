import "server-only";
import { env, requireEnv } from "@/lib/env";
import type { SvenskalagAttendance, SvenskalagWorkout } from "./types";

/**
 * svenskalag.se has no public API, so this client will log in with the
 * coach's own account and read the same pages a browser would.
 *
 * Rules for this module:
 * - Server-only. Credentials come from env vars and never reach the client.
 * - Session cookies are kept in memory on the server, never in the repo.
 * - Read-only. We never change anything on svenskalag.se.
 *
 * Planned approach (to be filled in once we've inspected the real pages):
 * 1. POST the login form (plus any anti-forgery token from the login page)
 *    and keep the resulting session cookie.
 * 2. Fetch the team's activity/calendar page and parse the training
 *    sessions. Prefer any JSON endpoint the page itself calls (look in the
 *    browser's network tab) over HTML scraping, since it's far less brittle.
 * 3. For each workout, fetch the attendance list.
 * If plain HTTP turns out not to work (heavy JS, bot protection), fall back
 * to a headless browser (Playwright) running in a server job.
 */
export class SvenskalagClient {
  private cookie: string | undefined;

  constructor(
    private readonly baseUrl = env.SVENSKALAG_BASE_URL,
    private readonly teamPath = env.SVENSKALAG_TEAM_PATH,
  ) {}

  get isConfigured() {
    return Boolean(env.SVENSKALAG_USERNAME && env.SVENSKALAG_PASSWORD && this.teamPath);
  }

  async login(): Promise<void> {
    requireEnv("SVENSKALAG_USERNAME");
    requireEnv("SVENSKALAG_PASSWORD");
    throw new NotImplementedError("SvenskalagClient.login");
  }

  async fetchWorkouts(range: { from: Date; to: Date }): Promise<SvenskalagWorkout[]> {
    await this.ensureSession();
    throw new NotImplementedError(`SvenskalagClient.fetchWorkouts (${range.from.toISOString()}–${range.to.toISOString()})`);
  }

  async fetchAttendance(workoutId: string): Promise<SvenskalagAttendance[]> {
    await this.ensureSession();
    throw new NotImplementedError(`SvenskalagClient.fetchAttendance (${workoutId})`);
  }

  private async ensureSession() {
    if (!this.cookie) await this.login();
  }
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
