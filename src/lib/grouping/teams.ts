import type { GroupingPlayer } from "./level-groups";

/** Rules for teams. Pure functions, so they can check anything Claude proposes. */

export type ProposedTeam = { league: number | null; playerIds: string[] };

/** The fewest teams each league count needs: two leagues from 4 teams, three from 6. */
export const MIN_TEAMS_PER_LEAGUE_COUNT: Record<number, number> = { 1: 1, 2: 4, 3: 6 };

/** The most leagues a number of teams can be split into. */
export function maxLeagueCount(teamCount: number): number {
  return teamCount >= MIN_TEAMS_PER_LEAGUE_COUNT[3] ? 3 : teamCount >= MIN_TEAMS_PER_LEAGUE_COUNT[2] ? 2 : 1;
}

/** Teams per league, stronger leagues first, with the stronger leagues taking any extra team. */
export function leagueSizes(teamCount: number, leagueCount: number): number[] {
  return Array.from(
    { length: leagueCount },
    (_, i) => Math.floor(teamCount / leagueCount) + (i < teamCount % leagueCount ? 1 : 0),
  );
}

export function findTeamProblems(
  teams: ProposedTeam[],
  players: GroupingPlayer[],
  options: { teamCount: number; leagueCount: number },
): string[] {
  const { teamCount, leagueCount } = options;
  const problems: string[] = [];
  if (teams.length !== teamCount) problems.push(`Expected ${teamCount} teams but got ${teams.length}.`);

  const known = new Set(players.map((p) => p.id));
  const placed = new Set<string>();
  for (const id of teams.flatMap((team) => team.playerIds)) {
    if (!known.has(id)) problems.push(`Unknown player ${id}.`);
    else if (placed.has(id)) problems.push(`Player ${id} is on more than one team.`);
    placed.add(id);
  }
  const missing = players.filter((p) => !placed.has(p.id)).map((p) => p.id);
  if (missing.length > 0) problems.push(`Players not placed: ${missing.join(", ")}.`);

  const leagues = leagueNumbers(leagueCount);
  if (leagueCount > 1) {
    const expected = leagueSizes(teamCount, leagueCount);
    const actual = leagues.map((league) => teams.filter((t) => t.league === league).length);
    if (actual.some((count, i) => count !== expected[i]) || teams.some((t) => !leagues.includes(t.league ?? 0))) {
      problems.push(
        `The leagues must have ${expected.map((count, i) => `${count} teams in league ${i + 1}`).join(", ")}.`,
      );
    }
  }

  const sizes = teams.map((t) => t.playerIds.length);
  if (sizes.length > 0 && Math.max(...sizes) - Math.min(...sizes) > 1) {
    problems.push(`Team sizes must differ by at most one, but they are ${sizes.join(", ")}.`);
  }
  return problems;
}

/**
 * Games are fairest when both sides have as many players, so every league should have
 * teams of one size. When the players don't divide evenly, only one league may be uneven,
 * and none if whole leagues can take the bigger teams.
 */
export function findUnevenLeagueProblems(teams: ProposedTeam[], leagueCount: number): string[] {
  const leagues = leagueCount > 1 ? leagueNumbers(leagueCount) : [null];
  const teamsByLeague = leagues.map((league) => teams.filter((t) => leagueCount === 1 || t.league === league));
  const uneven = teamsByLeague.filter((leagueTeams) => new Set(leagueTeams.map((t) => t.playerIds.length)).size > 1);

  const playerCount = teams.reduce((sum, t) => sum + t.playerIds.length, 0);
  const biggerTeams = teams.length > 0 ? playerCount % teams.length : 0;
  const allowed = canSum(teamsByLeague.map((leagueTeams) => leagueTeams.length), biggerTeams) ? 0 : 1;
  if (uneven.length <= allowed) return [];

  const sizes = teamsByLeague.map((leagueTeams) => leagueTeams.map((t) => t.playerIds.length).join(" v "));
  return [
    allowed === 0
      ? `Every league should have teams of the same size, but they are ${sizes.join("; ")}. Move players between neighbouring leagues so each league's teams are equal.`
      : `Only one league should have teams of different sizes, but they are ${sizes.join("; ")}. Move players between neighbouring leagues so the other leagues' teams are equal.`,
  ];
}

/** Whether some of the numbers add up to exactly the target. */
function canSum(numbers: number[], target: number): boolean {
  let reachable = new Set([0]);
  for (const n of numbers) reachable = new Set([...reachable, ...[...reachable].map((sum) => sum + n)]);
  return reachable.has(target);
}

/** The strongest and weakest levels shouldn't share a league, but headcounts can force it. */
export function findLeagueMixProblems(
  teams: ProposedTeam[],
  players: GroupingPlayer[],
  levelOrder: string[],
  leagueCount: number,
): string[] {
  if (leagueCount < 2) return [];
  const levelOf = new Map(players.map((p) => [p.id, p.levelCode]));
  const strongest = levelOrder[0];
  const weakest = levelOrder[levelOrder.length - 1];
  return leagueNumbers(leagueCount).flatMap((league) => {
    const levels = new Set(
      teams.filter((t) => t.league === league).flatMap((t) => t.playerIds.map((id) => levelOf.get(id))),
    );
    return levels.has(strongest) && levels.has(weakest)
      ? [`League ${league} has both ${strongest} and ${weakest} players. Keep those levels in separate leagues.`]
      : [];
  });
}

/**
 * Leagues follow the home levels: nobody in a league may have a stronger home level than
 * anyone in a stronger league. One level can still be split across neighbouring leagues.
 */
export function findLeagueOrderProblems(
  teams: ProposedTeam[],
  players: GroupingPlayer[],
  levelOrder: string[],
  leagueCount: number,
): string[] {
  if (leagueCount < 2) return [];
  const levelOf = new Map(players.map((p) => [p.id, p.levelCode]));
  const ranks = leagueNumbers(leagueCount).map((league) =>
    teams
      .filter((t) => t.league === league)
      .flatMap((t) => t.playerIds.map((id) => levelOrder.indexOf(levelOf.get(id) ?? "")))
      .filter((rank) => rank >= 0),
  );
  const problems: string[] = [];
  ranks.forEach((weaker, j) => {
    ranks.slice(0, j).forEach((stronger, i) => {
      if (weaker.length === 0 || stronger.length === 0) return;
      const best = Math.min(...weaker);
      const worst = Math.max(...stronger);
      if (best < worst) {
        problems.push(
          `League ${j + 1} has a ${levelOrder[best]} player while league ${i + 1} has a ${levelOrder[worst]} player. Swap them so the stronger player is in the stronger league.`,
        );
      }
    });
  });
  return problems;
}

function leagueNumbers(leagueCount: number): number[] {
  return Array.from({ length: leagueCount }, (_, i) => i + 1);
}
