import type { SvenskalagWorkout } from "./types";

/** svenskalag's member types we track. Others are guardians, volunteers and so on. */
const MEMBER_ROLES: Record<number, MemberRole> = { 1: "player", 2: "coach" };

const MONTHS = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** Thrown when a page doesn't look as expected, so a broken parse never overwrites good data. */
export class SvenskalagParseError extends Error {
  constructor(what: string) {
    super(`Unexpected svenskalag.se page: ${what}`);
    this.name = "SvenskalagParseError";
  }
}

export type MemberRole = "player" | "coach";

export type ParsedResponse = {
  memberId: string;
  name: string;
  role: MemberRole;
  response: "attending" | "declined" | "unanswered";
};

export type ParsedCoachContact = { name: string; email: string | null; phone: string | null; role: string | null };

export type ParsedMember = { memberId: string; name: string; role: MemberRole };

export type ParsedPresence = {
  /** False until the coaches have registered anyone as present. */
  registered: boolean;
  members: ParsedMember[];
};

export function calendarMonthPath(date: Date) {
  return `${date.getUTCFullYear()}/${MONTHS[date.getUTCMonth()]}`;
}

/** Trainings from one month's calendar page. Matches, camps and meetings are left out. */
export function parseCalendarMonth(
  html: string,
  year: number,
  month: number,
): SvenskalagWorkout[] {
  const workouts: SvenskalagWorkout[] = [];

  for (const chunk of html.split(/<tr id="[^"]*" class="clickable-row/).slice(1)) {
    const row = chunk.split("</tr>")[0];
    const title = decodeHtml(row.match(/class="activity-name">([^<]+)/)?.[1] ?? "").trim();
    if (!/^träning\b/i.test(title)) continue;

    const id = row.match(/\/aktivitet\/(\d+)\//)?.[1];
    const day = row.match(/<b>(\d+)<\/b>/)?.[1];
    const times = row.match(/(\d{2}:\d{2})\s*(?:<br>\s*<span class="text-muted">(\d{2}:\d{2}))?/);
    if (!id || !day || !times) throw new SvenskalagParseError(`calendar row for "${title}"`);

    const afterTitle = row.slice(row.indexOf("activity-name"));
    const location = afterTitle.match(/<span class="text-muted small">([^<]+)/)?.[1];

    workouts.push({
      id,
      title,
      startsAt: stockholmTime(year, month, Number(day), times[1]),
      endsAt: times[2] ? stockholmTime(year, month, Number(day), times[2]) : undefined,
      location: location ? decodeHtml(location).trim() : undefined,
    });
  }

  return workouts;
}

/** Players' and coaches' answers from a logged-in activity page. */
export function parseResponses(html: string): ParsedResponse[] {
  assertLoggedIn(html);

  const panes = [
    { id: "tabYes", response: "attending" },
    { id: "tabNo", response: "declined" },
    { id: "tabNoAnswer", response: "unanswered" },
  ] as const;
  const starts = panes.map((pane) => {
    const start = html.indexOf(`id="${pane.id}"`);
    if (start === -1) throw new SvenskalagParseError(`missing attendance list ${pane.id}`);
    return start;
  });

  return panes.flatMap((pane, i) => {
    const section = html.slice(starts[i], starts[i + 1] ?? html.length);
    const rows = section.matchAll(/<tbody data-memberid="(\d+)"[^>]*>([\s\S]*?)<\/tbody>/g);

    return [...rows].flatMap(([, memberId, row]) => {
      const member = row.match(/memberTypeId="(\d+)" name="([^"]*)"/);
      if (!member) throw new SvenskalagParseError("attendance row without member details");
      const role = MEMBER_ROLES[Number(member[1])];
      if (!role) return [];
      return [{ memberId, name: decodeHtml(member[2]), role, response: pane.response }];
    });
  });
}

/** The coaches' attendance check, embedded in the "Fyll i närvaro" page. */
export function parsePresence(html: string): ParsedPresence {
  const literal = html.match(/^\s*teamPresenceGroups:\s*(\[.*\]),?\s*$/m)?.[1];
  if (!literal) throw new SvenskalagParseError("missing attendance check data");

  type Member = { id: number; memberTypeId: number; fullName: string };
  let groups: { leaders?: Member[]; participants?: Member[] }[];
  try {
    groups = JSON.parse(quoteObjectKeys(literal));
  } catch {
    throw new SvenskalagParseError("unreadable attendance check data");
  }

  const members = groups.flatMap((g) => [...(g.leaders ?? []), ...(g.participants ?? [])]);
  return {
    registered: members.length > 0,
    members: members.flatMap((m) => {
      const role = MEMBER_ROLES[m.memberTypeId];
      return role ? [{ memberId: String(m.id), name: m.fullName, role }] : [];
    }),
  };
}

function assertLoggedIn(html: string) {
  if (!/isAuthenticated = true/.test(html)) throw new SvenskalagParseError("not logged in");
}

/** Turns a JS object literal with bare keys into JSON, leaving string contents alone. */
function quoteObjectKeys(literal: string) {
  return literal.replace(/"(?:[^"\\]|\\.)*"|([A-Za-z_]\w*)(?=:)/g, (match, key) =>
    key ? `"${key}"` : match,
  );
}

/**
 * Coaches' names, roles, emails and phone numbers from the contact list, which has no member ids.
 * Reads only the "Ledare" section, so parents' contact details are never picked up.
 */
export function parseCoachContacts(html: string): ParsedCoachContact[] {
  const heading = html.match(/>Ledare \((\d+)\)</);
  if (!heading || heading.index === undefined) throw new SvenskalagParseError("no Ledare section in the contact list");

  const start = heading.index;
  const end = html.indexOf(">Spelare (", start);
  if (end === -1) throw new SvenskalagParseError("no Spelare section after Ledare");

  const contacts = html
    .slice(start, end)
    .split(/<tr[\s>]/)
    .slice(1)
    .flatMap((row) => {
      const name = row.match(/<td colspan="2">\s*<span>\s*([^<]+)/)?.[1];
      if (!name) return [];
      const email = row.match(/href="mailto:([^"]+)"/)?.[1];
      // The mobile column comes first, and either number can be empty.
      const phone = [...row.matchAll(/href="tel:[^"]*"[^>]*>([^<]*)</g)]
        .map((link) => decodeHtml(link[1]).trim().replace(/\s*-\s*/, "-"))
        .find(Boolean);
      const role = row.match(/<i class="text-muted">([^<]*)</)?.[1];
      return [
        {
          name: decodeHtml(name).trim(),
          email: email ? decodeHtml(email).trim().toLowerCase() : null,
          phone: phone ?? null,
          role: role ? decodeHtml(role).trim() || null : null,
        },
      ];
    });

  if (contacts.length !== Number(heading[1])) {
    throw new SvenskalagParseError(`found ${contacts.length} coaches, expected ${heading[1]}`);
  }
  return contacts;
}

function decodeHtml(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The calendar shows local Swedish time; find the instant for that wall-clock time. */
function stockholmTime(year: number, month: number, day: number, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Stockholm",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(wallClock)
      .map((part) => [part.type, part.value]),
  );
  const shown = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(wallClock - (shown - wallClock));
}
