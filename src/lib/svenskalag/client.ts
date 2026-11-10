import "server-only";
import { env, requireEnv } from "@/lib/env";
import {
  calendarMonthPath,
  parseCalendarMonth,
  parseCoachContacts,
  parsePresence,
  parsePresenceForm,
  parseResponses,
  SvenskalagParseError,
  type PresenceFormGroup,
} from "./parse";
import { loadSession, saveSession } from "./session-store";
import type { SvenskalagAttendance, SvenskalagWorkout } from "./types";

/** Pause between page loads, to be gentle with svenskalag.se. */
const REQUEST_DELAY_MS = 250;

/**
 * svenskalag.se has no public API, so this client logs in with the coach's
 * own account and reads the same pages a browser would.
 *
 * Rules for this module:
 * - Server-only. Credentials come from env vars and never reach the client.
 * - Session cookies are saved encrypted in the database between runs, so the
 *   app only logs in when the saved session has expired. Never in the repo.
 * - Read-only, except for the attendance check. The only non-GET requests are the login and
 *   `savePresence`; never call the endpoints that save replies or send invites.
 * - Activity pages include guardians' phone numbers. Never store or log raw HTML.
 */
export class SvenskalagClient {
  private cookies = new Map<string, string>();
  /** True while using a session from an earlier run, which may have expired. */
  private usingSavedSession = false;

  constructor(
    private readonly baseUrl = env.SVENSKALAG_BASE_URL,
    private readonly teamPath = env.SVENSKALAG_TEAM_PATH,
  ) {}

  get isConfigured() {
    return Boolean(env.SVENSKALAG_USERNAME && env.SVENSKALAG_PASSWORD && this.teamPath);
  }

  async login(): Promise<void> {
    const response = await fetch(`${this.baseUrl}${this.teamPath}/logga-in`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        userName: requireEnv("SVENSKALAG_USERNAME"),
        userNameSite: "",
        userPass: requireEnv("SVENSKALAG_PASSWORD"),
        cbautologin: "on",
      }),
    });
    if (!response.ok) throw new Error(`svenskalag.se login failed with ${response.status}`);

    const result = (await response.json()) as { error?: string };
    if (result.error) throw new Error(`svenskalag.se login failed: ${result.error}`);

    this.cookies.clear();
    this.storeCookies(response);
    if (this.cookies.size === 0) throw new SvenskalagParseError("login set no session cookie");
    this.usingSavedSession = false;
    await saveSession(this.cookies);
  }

  async fetchWorkouts(range: { from: Date; to: Date }): Promise<SvenskalagWorkout[]> {
    return this.withSession(async () => {
      const workouts: SvenskalagWorkout[] = [];
      const month = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));

      while (month <= range.to) {
        const html = await this.get(`${this.teamPath}/kalender/${calendarMonthPath(month)}`);
        workouts.push(...parseCalendarMonth(html, month.getUTCFullYear(), month.getUTCMonth() + 1));
        month.setUTCMonth(month.getUTCMonth() + 1);
      }

      return workouts.filter((w) => w.startsAt >= range.from && w.startsAt <= range.to);
    });
  }

  async fetchAttendance(workoutId: string): Promise<SvenskalagAttendance[]> {
    const { responses, presence } = await this.withSession(async () => ({
      responses: parseResponses(await this.get(`${this.teamPath}/aktivitet/${workoutId}`)),
      presence: parsePresence(await this.get(this.presencePath(workoutId))),
    }));

    const present = new Set(presence.members.map((m) => m.memberId));
    const coachCheck = (memberId: string) => {
      if (!presence.registered) return null;
      return present.has(memberId) ? ("present" as const) : ("absent" as const);
    };

    const answered = new Set(responses.map((r) => r.memberId));
    return [
      ...responses.map((r) => ({
        workoutId,
        memberSvenskalagId: r.memberId,
        memberName: r.name,
        role: r.role,
        response: r.response,
        coachCheck: coachCheck(r.memberId),
      })),
      // People the coaches marked present without them ever answering.
      ...presence.members
        .filter((m) => !answered.has(m.memberId))
        .map((m) => ({
          workoutId,
          memberSvenskalagId: m.memberId,
          memberName: m.name,
          role: m.role,
          response: "unanswered" as const,
          coachCheck: "present" as const,
        })),
    ];
  }

  /** The attendance form of a workout: who is saved as present, and who can be. */
  async fetchPresenceForm(workoutId: string) {
    return this.withSession(async () => parsePresenceForm(await this.get(this.presencePath(workoutId))));
  }

  /**
   * Saves a workout's attendance check, as the form's "Spara" button does. This replaces the
   * whole list of who was present, so `groups` must hold everyone, built from `fetchPresenceForm`.
   */
  async savePresence(workoutId: string, groups: PresenceFormGroup[]): Promise<void> {
    await this.ensureSession();
    if (await this.postPresence(workoutId, groups)) return;
    // The likeliest reason is a session that has expired since it was saved.
    if (this.usingSavedSession) {
      await this.login();
      if (await this.postPresence(workoutId, groups)) return;
    }
    throw new Error("svenskalag.se did not save the attendance");
  }

  private presencePath(workoutId: string) {
    return `${this.teamPath}/controlpanel/presence/chooseparticipants/${workoutId}?reload=false`;
  }

  private async postPresence(workoutId: string, groups: PresenceFormGroup[]) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    const response = await fetch(
      `${this.baseUrl}${this.teamPath}/controlpanel/presence/savepresence?scheduleid=${workoutId}`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Cookie: this.cookieHeader() },
        body: JSON.stringify({ groups }),
      },
    );
    if (this.storeCookies(response)) await saveSession(this.cookies);
    if (!response.ok) return false;
    // A login page instead of JSON means the session wasn't accepted.
    const result = (await response.json().catch(() => null)) as { isSuccess?: boolean } | null;
    return result?.isSuccess === true;
  }

  async fetchCoachContacts() {
    return this.withSession(async () => parseCoachContacts(await this.get(`${this.teamPath}/kontaktlista`)));
  }

  /** An expired session shows up as a page that doesn't parse, so log in once and read it again. */
  private async withSession<T>(read: () => Promise<T>): Promise<T> {
    await this.ensureSession();
    try {
      return await read();
    } catch (error) {
      if (!this.usingSavedSession || !(error instanceof SvenskalagParseError)) throw error;
      await this.login();
      return read();
    }
  }

  private async ensureSession() {
    if (this.cookies.size > 0) return;
    const saved = await loadSession();
    if (saved) {
      this.cookies = saved;
      this.usingSavedSession = true;
    } else {
      await this.login();
    }
  }

  private async get(path: string) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    const response = await fetch(`${this.baseUrl}${path}`, {
      cache: "no-store",
      headers: { Cookie: this.cookieHeader() },
    });
    if (!response.ok) throw new Error(`svenskalag.se returned ${response.status} for ${path}`);
    if (this.storeCookies(response)) await saveSession(this.cookies);
    return response.text();
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Returns whether any cookie changed. */
  private storeCookies(response: Response) {
    let changed = false;
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (this.cookies.get(name) !== value) changed = true;
      this.cookies.set(name, value);
    }
    return changed;
  }
}
