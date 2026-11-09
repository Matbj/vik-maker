import type { GroupingPlayer } from "./level-groups";

/** Rules for teams. Pure functions, so they can check anything Claude proposes. */

export type ProposedTeam = { league: number | null; playerIds: string[] };

export function findTeamProblems(
  teams: ProposedTeam[],
  players: GroupingPlayer[],
  options: { teamCount: number; twoLeagues: boolean },
): string[] {
  const { teamCount, twoLeagues } = options;
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

  if (twoLeagues) {
    const firstLeague = teams.filter((team) => team.league === 1).length;
    if (firstLeague !== Math.ceil(teamCount / 2) || teams.some((t) => t.league !== 1 && t.league !== 2)) {
      problems.push(`League 1 must have ${Math.ceil(teamCount / 2)} teams and the rest must be league 2.`);
    }
  }

  for (const league of twoLeagues ? [1, 2] : [teams[0]?.league ?? null]) {
    const sizes = teams.filter((t) => !twoLeagues || t.league === league).map((t) => t.playerIds.length);
    if (sizes.length > 0 && Math.max(...sizes) - Math.min(...sizes) > 1) {
      problems.push(`Team sizes must differ by at most one, but they are ${sizes.join(", ")}.`);
    }
  }
  return problems;
}

/** The strongest and weakest levels shouldn't share a league, but headcounts can force it. */
export function findLeagueMixProblems(
  teams: ProposedTeam[],
  players: GroupingPlayer[],
  levelOrder: string[],
): string[] {
  const levelOf = new Map(players.map((p) => [p.id, p.levelCode]));
  const strongest = levelOrder[0];
  const weakest = levelOrder[levelOrder.length - 1];
  return [1, 2].flatMap((league) => {
    const levels = new Set(
      teams.filter((t) => t.league === league).flatMap((t) => t.playerIds.map((id) => levelOf.get(id))),
    );
    return levels.has(strongest) && levels.has(weakest)
      ? [`League ${league} has both ${strongest} and ${weakest} players. Keep those levels in separate leagues.`]
      : [];
  });
}
