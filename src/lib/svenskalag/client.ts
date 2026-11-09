import "server-only";
import { env, requireEnv } from "@/lib/env";
import {
  calendarMonthPath,
  parseCalendarMonth,
  parsePresence,
  parseResponses,
  SvenskalagParseError,
} from "./parse";
import type { SvenskalagAttendance, SvenskalagWorkout } from "./types";

/** Pause between page loads, to be gentle with svenskalag.se. */
const REQUEST_DELAY_MS = 250;

/**
 * svenskalag.se has no public API, so this client logs in with the coach's
 * own account and reads the same pages a browser would.
 *
 * Rules for this module:
 * - Server-only. Credentials come from env vars and never reach the client.
 * - Session cookies are kept in memory on the server, never in the repo.
 * - Read-only. The login POST is the only non-GET request; never call the
 *   endpoints that save replies, send invites or register attendance.
 * - Activity pages include guardians' phone numbers. Never store or log raw HTML.
 */
export class SvenskalagClient {
  private cookies = new Map<string, string>();

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

    this.storeCookies(response);
    if (this.cookies.size === 0) throw new SvenskalagParseError("login set no session cookie");
  }

  async fetchWorkouts(range: { from: Date; to: Date }): Promise<SvenskalagWorkout[]> {
    await this.ensureSession();
    const workouts: SvenskalagWorkout[] = [];
    const month = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));

    while (month <= range.to) {
      const html = await this.get(`${this.teamPath}/kalender/${calendarMonthPath(month)}`);
      workouts.push(...parseCalendarMonth(html, month.getUTCFullYear(), month.getUTCMonth() + 1));
      month.setUTCMonth(month.getUTCMonth() + 1);
    }

    return workouts.filter((w) => w.startsAt >= range.from && w.startsAt <= range.to);
  }

  async fetchAttendance(workoutId: string): Promise<SvenskalagAttendance[]> {
    await this.ensureSession();
    const responses = parseResponses(await this.get(`${this.teamPath}/aktivitet/${workoutId}`));
    const presence = parsePresence(
      await this.get(`${this.teamPath}/controlpanel/presence/chooseparticipants/${workoutId}?reload=false`),
    );

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

  private async ensureSession() {
    if (this.cookies.size === 0) await this.login();
  }

  private async get(path: string) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    const response = await fetch(`${this.baseUrl}${path}`, {
      cache: "no-store",
      headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    if (!response.ok) throw new Error(`svenskalag.se returned ${response.status} for ${path}`);
    this.storeCookies(response);
    return response.text();
  }

  private storeCookies(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}
